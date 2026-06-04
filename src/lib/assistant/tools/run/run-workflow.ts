import { z } from "zod";

import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";
import { awaitRunCompletion } from "./await-run-completion";

/**
 * run_workflow — Slice 7.3 (ADR-0042), upgraded by ADR-0069 F14.
 *
 * Kick off a full workflow run via the engine (same path as the
 * user clicking the global Run button). AWAITS completion and
 * returns a structured per-node summary, so the LLM can verify
 * outcomes without a follow-up `read_node_state` round-trip — and,
 * critically, CANNOT report success when nodes errored.
 */

const argsSchema = z.object({}).strict();

export const runWorkflowTool: AssistantTool = {
  name: "run_workflow",
  description:
    "Trigger a full engine run on the current canvas and wait until every node finishes. Returns a structured summary `{ ok, runId, nodeSummary, errors, totalCostUsd }`. `ok` is false if any node errored; check `errors[]` and surface them to the user instead of declaring success.",
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
    const runPromise = useExecutionStore.getState().startRun();
    return awaitRunCompletion({ runPromise });
  },
};
