import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

const argsSchema = z.object({ nodeId: z.string().min(1) }).strict();

export const removeNodeTool: AssistantTool = {
  name: "remove_node",
  description:
    "Delete a node by id. Cascade-removes any edges connected to it. Idempotent.",
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
    useWorkflowStore.getState().removeNode(nodeId);
    return { ok: true };
  },
};
