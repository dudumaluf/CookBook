import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

const argsSchema = z.object({ edgeId: z.string().min(1) }).strict();

export const removeEdgeTool: AssistantTool = {
  name: "remove_edge",
  description:
    "Delete an edge by id. Idempotent — a missing id is a no-op.",
  parameters: {
    type: "object",
    properties: {
      edgeId: { type: "string" },
    },
    required: ["edgeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const { edgeId } = argsSchema.parse(rawArgs);
    useWorkflowStore.getState().removeEdge(edgeId);
    return { ok: true };
  },
};
