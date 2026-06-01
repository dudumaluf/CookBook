import type { RecipeRecord } from "@/lib/repositories/recipe-repository";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

import type { PromptEntry } from "./types";

/**
 * Cookbook Library — recipe-prompt extractor (Phase A).
 *
 * Walks a recipe's saved subgraph and surfaces the embedded prompts as
 * `PromptEntry`s for the Prompts tab. We extract from two node kinds:
 *
 *   - `text` nodes: their `text` config is the prompt body. Most recipes
 *     keep their system / user prompt content in Text nodes feeding
 *     downstream `llm-text` nodes — that's the canonical pattern.
 *   - `llm-text` nodes: surfaced as a meta-entry pointing at the LLM
 *     call (model + temperature) so the user can see "this is where
 *     the call actually happens" alongside the prompts that feed it.
 *
 * The `purpose` field is inferred from the wiring: if a Text node feeds
 * an `llm-text` node's `system` handle, the entry's purpose is "system
 * prompt"; if it feeds `user`, "user prompt"; if it feeds a Text Concat
 * which then feeds an LLM, "system prompt fragment" (best-effort, not
 * exhaustive). When inference fails the field is absent.
 *
 * Pure function — no IO, no store reads. Safe to run on any
 * `RecipeRecord` (system or user) the caller already holds.
 */

interface SubgraphLike {
  nodes: NodeInstance[];
  edges: WorkflowEdge[];
}

/**
 * Skip Text nodes whose body is shorter than this — usually
 * placeholders / blank inputs, not real prompts. Keeps the Prompts tab
 * from drowning in noise.
 */
const MIN_PROMPT_LENGTH = 16;

/**
 * Recipe roots have config keyed by node kind. Match these shapes
 * structurally so the extractor stays decoupled from the per-node
 * TypeScript types.
 */
function getTextBody(config: unknown): string {
  if (!config || typeof config !== "object") return "";
  const text = (config as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function getLlmModel(config: unknown): string | undefined {
  if (!config || typeof config !== "object") return undefined;
  const model = (config as { model?: unknown }).model;
  return typeof model === "string" ? model : undefined;
}

function getLlmTemperature(config: unknown): number | undefined {
  if (!config || typeof config !== "object") return undefined;
  const t = (config as { temperature?: unknown }).temperature;
  return typeof t === "number" ? t : undefined;
}

/**
 * Best-effort: return a human-readable purpose given a Text node's
 * outgoing edges. Walks at most one level of `text-concat` chaining
 * (if a Text feeds Concat which feeds LLM, we still surface the LLM
 * relationship). Returns undefined when no informative downstream is
 * found.
 */
function inferTextPurpose(
  textNodeId: string,
  subgraph: SubgraphLike,
): string | undefined {
  const directDownstream = subgraph.edges.filter((e) => e.source === textNodeId);
  if (directDownstream.length === 0) return undefined;

  const labels: string[] = [];
  for (const edge of directDownstream) {
    const target = subgraph.nodes.find((n) => n.id === edge.target);
    if (!target) continue;

    if (target.kind === "llm-text") {
      if (edge.targetHandle === "system") {
        labels.push("system prompt");
      } else if (edge.targetHandle === "user") {
        labels.push("user prompt");
      } else {
        labels.push(`LLM input (${edge.targetHandle})`);
      }
      continue;
    }

    if (target.kind === "text-concat") {
      // Follow one hop to see if the concat output feeds an llm-text.
      const onwards = subgraph.edges.filter((e) => e.source === target.id);
      for (const onEdge of onwards) {
        const onTarget = subgraph.nodes.find((n) => n.id === onEdge.target);
        if (onTarget?.kind === "llm-text") {
          labels.push(
            onEdge.targetHandle === "system"
              ? "system prompt fragment"
              : onEdge.targetHandle === "user"
                ? "user prompt fragment"
                : "LLM input fragment",
          );
        }
      }
      if (onwards.length === 0) labels.push("text fragment");
      continue;
    }

    if (target.kind === "array" || target.kind === "list") {
      // The Seedance Prompt Director pattern: Text → Array → List → Concat → LLM.
      labels.push(
        target.kind === "array" ? "template variants source" : "template selector source",
      );
      continue;
    }

    // Generic fallback — show the kind so the user can tell.
    labels.push(`feeds ${target.kind}`);
  }

  if (labels.length === 0) return undefined;
  // Dedupe while preserving order.
  return Array.from(new Set(labels)).join(", ");
}

/**
 * Build a stable PromptEntry key for a recipe's internal node. The key
 * is `recipe.<recipeId>.<internalNodeId>` so React + future override
 * lookup never collide between recipes.
 */
function recipePromptKey(recipeId: string, internalNodeId: string): string {
  return `recipe.${recipeId}.${internalNodeId}`;
}

/**
 * Extract every prompt-bearing node from one recipe's subgraph.
 * Always returns Text-node prompts; optionally appends an llm-text
 * meta-entry per LLM call so the UI can render the model + temperature.
 */
export function extractRecipePrompts(
  recipe: RecipeRecord,
  options: { includeLlmCalls?: boolean } = {},
): PromptEntry[] {
  const includeLlm = options.includeLlmCalls ?? true;
  const subgraph: SubgraphLike = {
    nodes: recipe.subgraph.nodes ?? [],
    edges: recipe.subgraph.edges ?? [],
  };

  const out: PromptEntry[] = [];

  for (const node of subgraph.nodes) {
    if (node.kind === "text") {
      const body = getTextBody(node.config);
      if (body.length < MIN_PROMPT_LENGTH) continue;
      const purpose = inferTextPurpose(node.id, subgraph);
      const labelHint = node.label ? ` — ${node.label}` : "";
      out.push({
        key: recipePromptKey(recipe.id, node.id),
        title: `${recipe.name} → Text node${labelHint}`,
        description: purpose
          ? `Recipe-internal text feeding ${purpose}.`
          : "Recipe-internal text. Used as input to a downstream node.",
        section: "recipe-internal",
        content: body,
        recipeId: recipe.id,
        recipeName: recipe.name,
        internalNodeId: node.id,
        internalNodeKind: node.kind,
        purpose,
      });
      continue;
    }

    if (node.kind === "llm-text" && includeLlm) {
      const model = getLlmModel(node.config) ?? "(model not set)";
      const temperature = getLlmTemperature(node.config);
      const labelHint = node.label ? ` — ${node.label}` : "";
      const tempBlock =
        temperature === undefined ? "" : `, temperature ${temperature}`;
      out.push({
        key: recipePromptKey(recipe.id, node.id),
        title: `${recipe.name} → LLM call${labelHint}`,
        description: `LLM call inside the recipe. Model: ${model}${tempBlock}. Inputs (system, user, images) come from upstream nodes.`,
        section: "recipe-internal",
        content: `model: ${model}${tempBlock}\n\n[The actual prompt text comes from Text nodes wired to this node's "system" and "user" inputs. Look for those entries above.]`,
        recipeId: recipe.id,
        recipeName: recipe.name,
        internalNodeId: node.id,
        internalNodeKind: node.kind,
        purpose: "LLM call",
      });
    }
  }

  return out;
}

/**
 * Extract prompts from many recipes at once. Convenience wrapper for
 * the Prompts tab which lists everything by section.
 */
export function extractAllRecipePrompts(
  recipes: readonly RecipeRecord[],
  options: { includeLlmCalls?: boolean } = {},
): PromptEntry[] {
  const out: PromptEntry[] = [];
  for (const recipe of recipes) {
    out.push(...extractRecipePrompts(recipe, options));
  }
  return out;
}
