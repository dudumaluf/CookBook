import { z } from "zod";

import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * read_canvas — Slice 7.2 (ADR-0041).
 *
 * Returns the FULL workflow graph as JSON: every node id, kind,
 * position, config, plus every edge. Includes per-node execution
 * status when present. Used when the LLM needs more detail than the
 * compact canvas knowledge bundle gives (e.g. inspecting a specific
 * config value before patching it).
 *
 * No arguments. Always returns the whole canvas — pagination not
 * needed at M0a scale (typical workflows are <30 nodes).
 */

const argsSchema = z.object({}).strict();

export const readCanvasTool: AssistantTool = {
  name: "read_canvas",
  description:
    "Read the full live canvas: every node (id, kind, position, config) plus every edge plus per-node execution status. Use when you need detailed config or status beyond the canvas summary in the system prompt.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    argsSchema.parse(rawArgs);
    const { nodes, edges, selectedNodeIds } = useWorkflowStore.getState();
    const records = useExecutionStore.getState().records;
    return {
      nodes: nodes.map((n) => {
        const record = records.get(n.id);
        return {
          id: n.id,
          kind: n.kind,
          position: n.position,
          config: n.config,
          status: record?.status ?? "idle",
          ...(record?.usage?.costUsd !== undefined
            ? { costUsd: record.usage.costUsd }
            : {}),
          ...(record?.error ? { error: record.error } : {}),
        };
      }),
      edges,
      selectedNodeIds,
    };
  },
};
