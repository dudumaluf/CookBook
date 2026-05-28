import { z } from "zod";

import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * run_workflow — Slice 7.3 (ADR-0042).
 *
 * Kick off a full workflow run via the engine (same path as the
 * user clicking the global Run button). Returns the runId.
 *
 * The tool returns AS SOON AS the run kicks off — it does NOT
 * await completion. The reasoner can poll read_node_state if it
 * wants to wait for results, or it can simply emit a final text
 * message and let the user watch the engine progress in the UI.
 */

const argsSchema = z.object({}).strict();

export const runWorkflowTool: AssistantTool = {
  name: "run_workflow",
  description:
    "Trigger a full engine run on the current canvas. Returns the runId immediately — does NOT block until completion. Use as the final step of a plan when you want the user to watch the engine in real time.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    argsSchema.parse(rawArgs ?? {});
    const ws = useWorkflowStore.getState();
    if (ws.nodes.length === 0) {
      return { ok: false, error: "Canvas is empty — nothing to run." };
    }
    if (useExecutionStore.getState().isRunning) {
      return {
        ok: false,
        error: "A run is already in flight. Cancel it first or wait.",
      };
    }
    useExecutionStore.getState().startRun();
    return {
      ok: true,
      runId: useExecutionStore.getState().runId,
    };
  },
};
