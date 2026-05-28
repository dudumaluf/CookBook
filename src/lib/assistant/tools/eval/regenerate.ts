import { z } from "zod";

import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * regenerate — Slice 7.4 (ADR-0043).
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
    "Re-run the source node of a generation, optionally patching its config first. Use when the user says 'try that again but with X'. The source node must still exist on canvas.",
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
      ws.updateNodeConfig(gen.nodeId, args.configPatch);
    }
    useExecutionStore.getState().startRunFrom(gen.nodeId);
    return {
      ok: true,
      runId: useExecutionStore.getState().runId,
      nodeId: gen.nodeId,
    };
  },
};
