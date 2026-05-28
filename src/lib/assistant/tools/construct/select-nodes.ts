import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

const argsSchema = z
  .object({
    nodeIds: z.array(z.string().min(1)),
  })
  .strict();

export const selectNodesTool: AssistantTool = {
  name: "select_nodes",
  description:
    "Replace the canvas selection with the given node ids. Use before save_selection_as_recipe (which captures the current selection) or to draw the user's eye to a specific subgraph.",
  parameters: {
    type: "object",
    properties: {
      nodeIds: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["nodeIds"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    useWorkflowStore.getState().setSelectedNodeIds(args.nodeIds);
    return { ok: true, selectedCount: args.nodeIds.length };
  },
};
