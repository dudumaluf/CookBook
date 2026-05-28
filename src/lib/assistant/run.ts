"use client";

import { callOpenRouter } from "@/lib/llm/call-openrouter";
import { instantiateRecipeOnCanvas } from "@/lib/recipes/instantiate";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import { buildKnowledgeBundle } from "./knowledge";
import {
  type AssistantPlan,
  assistantPlanSchema,
  type AssistantStep,
} from "./types";

/**
 * Assistant orchestrator — Slice 6.4b.
 *
 * Two phases:
 *   1. PLAN — `planFromAssistant(userMessage)`: assembles context from
 *      stores, calls Fal OpenRouter with the system prompt, parses
 *      response, validates with Zod. Returns `{ plan, error?, costUsd }`.
 *   2. EXECUTE — `executePlan(plan)`: walks the steps and applies them
 *      against the workflow + asset stores, then triggers `startRun`.
 *      Steps are applied synchronously (each step is just a store
 *      mutation), then a single async run kicks off at the end.
 *
 * No retry / backoff — invalid LLM JSON is surfaced as an error to the
 * user. They re-prompt or edit. Tool-loop / multi-turn agentic loop is
 * out of scope for M0a; ships in M1.
 */

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

export interface PlanResult {
  plan?: AssistantPlan;
  rawText: string;
  error?: string;
  costUsd?: number;
}

interface PlanFromAssistantOptions {
  userMessage: string;
  signal: AbortSignal;
  ownerId: string;
  /** Override for tests. Defaults to anthropic/claude-sonnet-4.5. */
  model?: string;
}

/**
 * Strip optional code fences if the LLM included them despite our
 * instruction. Defensive — most well-tuned models obey the JSON-only
 * directive but a few wrap output in ```json … ``` regardless.
 */
function stripFences(s: string): string {
  const fenced = s.trim().match(/^```(?:json)?\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1]!.trim() : s.trim();
}

const PLAN_INSTRUCTIONS = `## RESPONSE SHAPE

Always respond with a JSON object matching:

{
  "reasoning": string,                  // 1-2 sentences explaining what you're doing
  "steps": [                            // ordered execution list
    { "kind": "clear-canvas" } |
    { "kind": "instantiate-recipe", "recipeId": <uuid>, "position": { "x": 100, "y": 100 } } |
    { "kind": "set-node-config", "nodeId": <string>, "config": { ... } } |
    { "kind": "link-soul-id", "nodeId": <string>, "assetId": <string> } |
    { "kind": "run" }
  ],
  "estimatedCostUsd": number,           // sum of gen+llm costs in this plan
  "confirmation": string                // 1 line "are you sure?" if cost > 0.05
}

DO NOT include markdown fences. DO NOT explain in prose. Output ONLY the JSON object.

If the user just asked a question (no action needed), still respond with the JSON shape — \`steps: []\` and put the answer in \`reasoning\`. The user reads the reasoning verbatim.`;

export async function planFromAssistant(
  options: PlanFromAssistantOptions,
): Promise<PlanResult> {
  const { userMessage, signal, ownerId, model = DEFAULT_MODEL } = options;
  const projectId = useProjectStore.getState().id;
  if (!projectId) {
    return {
      rawText: "",
      error: "No active project — sign in and load a project first.",
    };
  }
  // Slice 7.2 — full knowledge bundle (8 dimensions) + multi-turn
  // conversation messages threaded into the LLM call.
  const bundle = await buildKnowledgeBundle({ ownerId, projectId });
  const system = bundle.system + "\n\n" + PLAN_INSTRUCTIONS;
  // Conversation history goes BEFORE the new user message so the LLM
  // sees follow-up framing ("now do X" makes sense after "did Y").
  const messages = [
    ...bundle.messages,
    { role: "user" as const, content: userMessage },
  ];
  let response;
  try {
    response = await callOpenRouter({
      model,
      messages,
      system,
      temperature: 0.2,
      maxTokens: 1500,
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    const msg = err instanceof Error ? err.message : String(err);
    return { rawText: "", error: `LLM call failed: ${msg}` };
  }
  const rawText = response.text;
  const stripped = stripFences(rawText);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripped);
  } catch {
    return {
      rawText,
      error: "Assistant did not return valid JSON. Try rephrasing.",
      costUsd: response.costUsd,
    };
  }
  const validated = assistantPlanSchema.safeParse(parsedJson);
  if (!validated.success) {
    return {
      rawText,
      error: `Assistant response failed validation: ${validated.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      costUsd: response.costUsd,
    };
  }
  return {
    plan: validated.data,
    rawText,
    costUsd: response.costUsd,
  };
}

interface ExecutePlanResult {
  ok: boolean;
  /** Ids of nodes spawned via instantiate-recipe steps. */
  spawnedNodeIds: string[];
  /** Step kinds executed in order — useful for telemetry/UI. */
  applied: AssistantStep["kind"][];
  /** When the engine kicked off, the runId. */
  runId?: number;
  error?: string;
}

/**
 * Apply each step against the live stores in order. The instantiate-
 * recipe step has to spawn before set-node-config / link-soul-id can
 * reference the new node ids — but the LLM uses the recipe's saved
 * node ids ("text-prompt", "soul-id", "higgsfield") in its plan, not
 * the spawned ids. We bridge that with a `recipeNodeIdMap` carried
 * across steps.
 */
export async function executePlan(plan: AssistantPlan): Promise<ExecutePlanResult> {
  const applied: AssistantStep["kind"][] = [];
  const spawnedNodeIds: string[] = [];
  // Maps recipe-saved id (e.g. "text-prompt") → spawned canvas id.
  const recipeNodeIdMap = new Map<string, string>();

  try {
    for (const step of plan.steps) {
      switch (step.kind) {
        case "clear-canvas": {
          useWorkflowStore.setState({
            nodes: [],
            edges: [],
            selectedNodeIds: [],
            selectedEdgeIds: [],
          });
          applied.push("clear-canvas");
          break;
        }
        case "instantiate-recipe": {
          const recipe = await getRecipeRepository().get(step.recipeId);
          if (!recipe) {
            return {
              ok: false,
              spawnedNodeIds,
              applied,
              error: `Recipe ${step.recipeId} not found`,
            };
          }
          const result = instantiateRecipeOnCanvas({
            subgraph: recipe.subgraph,
            position: step.position,
          });
          spawnedNodeIds.push(...result.nodeIds);
          // Build the saved-id → fresh-id map by walking the recipe's
          // saved nodes in the same order they were spawned.
          recipe.subgraph.nodes.forEach((savedNode, i) => {
            recipeNodeIdMap.set(savedNode.id, result.nodeIds[i]!);
          });
          applied.push("instantiate-recipe");
          break;
        }
        case "set-node-config": {
          const liveId = recipeNodeIdMap.get(step.nodeId) ?? step.nodeId;
          useWorkflowStore.getState().updateNodeConfig(liveId, step.config);
          applied.push("set-node-config");
          break;
        }
        case "link-soul-id": {
          const liveId = recipeNodeIdMap.get(step.nodeId) ?? step.nodeId;
          useWorkflowStore
            .getState()
            .updateNodeConfig(liveId, { assetId: step.assetId });
          applied.push("link-soul-id");
          break;
        }
        case "run": {
          // Kick off the run synchronously then move on; the engine
          // handles its own progress + records.
          useExecutionStore.getState().startRun();
          applied.push("run");
          return {
            ok: true,
            spawnedNodeIds,
            applied,
            runId: useExecutionStore.getState().runId,
          };
        }
        default: {
          // exhaustive — TS compiler should catch missing kinds.
          const _exhaustive: never = step;
          return {
            ok: false,
            spawnedNodeIds,
            applied,
            error: `Unknown step: ${JSON.stringify(_exhaustive)}`,
          };
        }
      }
    }
    // Plan with no `run` step — that's fine, returns ok without runId.
    return { ok: true, spawnedNodeIds, applied };
  } catch (err) {
    return {
      ok: false,
      spawnedNodeIds,
      applied,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
