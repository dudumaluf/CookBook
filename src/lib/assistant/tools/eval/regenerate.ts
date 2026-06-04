import { z } from "zod";

import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";
import { validateConfigPatch } from "../construct/validate-config-patch";
import { awaitRunCompletion } from "../run/await-run-completion";

/**
 * regenerate — Slice 7.4 (ADR-0043), upgraded by ADR-0069 F14 + F18.
 *
 * Re-run the source node of a generation with optional config
 * adjustments. Convenience wrapper around update_node_config +
 * run_from — saves the LLM two tool calls when the user says
 * "regenerate that one but with more contrast".
 *
 * The source node is looked up from the generation row. If it no
 * longer exists on canvas (e.g. user deleted it), the tool returns
 * `ok: false` with a hint to re-instantiate.
 *
 * `configPatch` is a free-form record. The LLM is responsible for
 * picking the right keys (Higgsfield's `aspectRatio`, LLM's `model`,
 * etc.) — the registry's defaultConfig + read_node_state give it
 * the schema to work from.
 *
 * F18: when `configPatch` is provided we run it through the SAME
 * `validateConfigPatch` gate that `update_node_config` uses, so
 * regenerate cannot smuggle a hallucinated key past the precision
 * checks. Old behavior would happily merge `{ separator: "**" }`
 * onto an array node, kick off the run, and return success against
 * a graph the LLM had silently corrupted.
 *
 * AWAITS completion (F14) so the LLM gets the final node state
 * — including any error — before composing its user-facing reply.
 */

const argsSchema = z
  .object({
    generationId: z.string().min(1),
    configPatch: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const regenerateTool: AssistantTool = {
  name: "regenerate",
  description:
    "Re-run the source node of a generation (optionally patching config first) and WAIT until completion. The patch is validated against the source node's kind via the same precision gate as update_node_config — a bad key fails fast, before any run starts. Returns `{ ok, runId, nodeSummary, errors, totalCostUsd }`; surface errors to the user instead of claiming success.",
  parameters: {
    type: "object",
    properties: {
      generationId: { type: "string" },
      configPatch: {
        type: "object",
        description:
          "Optional config tweaks shallow-merged onto the source node's config before re-running.",
      },
    },
    required: ["generationId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const gen = await getGenerationRepository().get(args.generationId);
    if (!gen) {
      return { ok: false, error: `No generation with id ${args.generationId}` };
    }
    const ws = useWorkflowStore.getState();
    const node = ws.nodes.find((n) => n.id === gen.nodeId);
    if (!node) {
      return {
        ok: false,
        error: `Source node ${gen.nodeId} no longer exists. Re-instantiate the recipe before regenerating.`,
      };
    }
    if (useExecutionStore.getState().isRunning) {
      return {
        ok: false,
        error: "A run is already in flight. Cancel it first or wait.",
      };
    }
    if (args.configPatch) {
      const validationError = validateConfigPatch(node.kind, args.configPatch);
      if (validationError) {
        return { ok: false, error: validationError, nodeId: gen.nodeId };
      }
      ws.updateNodeConfig(gen.nodeId, args.configPatch);
    }
    const affected = collectAncestors(gen.nodeId);
    const runPromise = useExecutionStore.getState().startRunFrom(gen.nodeId);
    const summary = await awaitRunCompletion({
      runPromise,
      affectedNodeIds: affected,
    });
    return { ...summary, nodeId: gen.nodeId };
  },
};

function collectAncestors(nodeId: string): string[] {
  const { edges } = useWorkflowStore.getState();
  const seen = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of edges) {
      if (e.target === cur && !seen.has(e.source)) {
        seen.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return Array.from(seen);
}
