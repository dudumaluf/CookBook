import { z } from "zod";

import { unpackComposite } from "@/lib/recipes/unpack-composite";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

const argsSchema = z
  .object({ compositeNodeId: z.string().min(1) })
  .strict();

export const unpackCompositeTool: AssistantTool = {
  name: "unpack_composite",
  description:
    "Replace a composite node with its expanded inner subgraph. Use to make a recipe's internals editable on canvas.",
  parameters: {
    type: "object",
    properties: {
      compositeNodeId: { type: "string" },
    },
    required: ["compositeNodeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    const node = ws.nodes.find((n) => n.id === args.compositeNodeId);
    if (!node) {
      return { ok: false, error: `No node with id ${args.compositeNodeId}` };
    }
    if (node.kind !== "composite") {
      return {
        ok: false,
        error: `Node ${args.compositeNodeId} is kind '${node.kind}', not 'composite'.`,
      };
    }
    unpackComposite(args.compositeNodeId);
    return { ok: true };
  },
};
