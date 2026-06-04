import { z } from "zod";

import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";
import { awaitRunCompletion } from "./await-run-completion";

const argsSchema = z.object({ nodeId: z.string().min(1) }).strict();

/**
 * ADR-0069 F14 — `run_from` awaits completion and reports per-node
 * status of the target + its ancestors. This is the path that says
 * "regenerate this LLM"; the LLM was previously claiming victory
 * before the run finished, which is why the user kept seeing
 * "phantom" non-changes.
 */

export const runFromTool: AssistantTool = {
  name: "run_from",
  description:
    "Trigger a partial run (target node + its upstream ancestors) and WAIT until completion. Sibling branches stay untouched. Returns `{ ok, runId, nodeSummary, errors, totalCostUsd }` covering only the affected subgraph; check `ok` before reporting success to the user.",
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
    const affected = collectAncestors(nodeId);
    const runPromise = useExecutionStore.getState().startRunFrom(nodeId);
    return awaitRunCompletion({ runPromise, affectedNodeIds: affected });
  },
};

/**
 * Collect `nodeId` + all upstream ancestors (transitive). Used to
 * scope the post-run summary to nodes that the engine actually
 * touched, instead of dragging unrelated branches into the report.
 */
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
