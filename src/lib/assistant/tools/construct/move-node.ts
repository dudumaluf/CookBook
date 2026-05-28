import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

const argsSchema = z
  .object({
    nodeId: z.string().min(1),
    position: z.object({ x: z.number(), y: z.number() }),
  })
  .strict();

export const moveNodeTool: AssistantTool = {
  name: "move_node",
  description:
    "Move a node to a new canvas position. Use to reorganize cluttered graphs into a clean topological flow (left-to-right or top-to-bottom).",
  parameters: {
    type: "object",
    properties: {
      nodeId: { type: "string" },
      position: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
        additionalProperties: false,
      },
    },
    required: ["nodeId", "position"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    if (!ws.nodes.find((n) => n.id === args.nodeId)) {
      return { ok: false, error: `No node with id ${args.nodeId}` };
    }
    ws.moveNode(args.nodeId, args.position);
    return { ok: true };
  },
};
