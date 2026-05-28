import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * add_edge — Slice 7.3 (ADR-0042).
 *
 * Connect two handles. Workflow-store's addEdge enforces:
 *   - no self-loops,
 *   - no duplicate edge into the same single-target handle.
 * If the edge is rejected, returns ok: false so the LLM can adjust.
 */

const argsSchema = z
  .object({
    source: z.string().min(1),
    sourceHandle: z.string().min(1),
    target: z.string().min(1),
    targetHandle: z.string().min(1),
  })
  .strict();

export const addEdgeTool: AssistantTool = {
  name: "add_edge",
  description:
    "Connect two node handles. Source must be an output handle, target an input handle. Returns the new edge id, or ok: false if rejected (self-loop or duplicate target).",
  parameters: {
    type: "object",
    properties: {
      source: { type: "string", description: "Source node id." },
      sourceHandle: {
        type: "string",
        description: "Output handle id on the source node.",
      },
      target: { type: "string", description: "Target node id." },
      targetHandle: {
        type: "string",
        description: "Input handle id on the target node.",
      },
    },
    required: ["source", "sourceHandle", "target", "targetHandle"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    if (!ws.nodes.find((n) => n.id === args.source)) {
      return { ok: false, error: `No source node ${args.source}` };
    }
    if (!ws.nodes.find((n) => n.id === args.target)) {
      return { ok: false, error: `No target node ${args.target}` };
    }
    const id = ws.addEdge(args);
    if (!id) {
      return {
        ok: false,
        error:
          "Edge rejected (self-loop, duplicate, or capacity violation). Inspect read_canvas to see the conflict.",
      };
    }
    return { ok: true, edgeId: id };
  },
};
