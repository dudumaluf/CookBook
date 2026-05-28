import { z } from "zod";

import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

const argsSchema = z.object({ nodeId: z.string().min(1) }).strict();

export const runFromTool: AssistantTool = {
  name: "run_from",
  description:
    "Trigger a partial run targeting one node + its upstream ancestors only (Run-here). Sibling branches stay untouched. Use when you want to refresh a specific output without re-running the whole graph.",
  parameters: {
    type: "object",
    properties: {
      nodeId: { type: "string" },
    },
    required: ["nodeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const { nodeId } = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    if (!ws.nodes.find((n) => n.id === nodeId)) {
      return { ok: false, error: `No node with id ${nodeId}` };
    }
    if (useExecutionStore.getState().isRunning) {
      return {
        ok: false,
        error: "A run is already in flight. Cancel it first or wait.",
      };
    }
    useExecutionStore.getState().startRunFrom(nodeId);
    return {
      ok: true,
      runId: useExecutionStore.getState().runId,
    };
  },
};
