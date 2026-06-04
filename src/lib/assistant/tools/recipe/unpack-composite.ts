import { z } from "zod";

import { unpackComposite } from "@/lib/recipes/unpack-composite";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * unpack_composite — Slice 7.3 + post-write receipts (2026-06-03).
 *
 * Replaces 1 composite node with N inner nodes + edges. Receipt
 * counts the spawned nodes/edges so the LLM can quote the actual
 * fan-out instead of a vague "expanded the recipe".
 */

const argsSchema = z
  .object({ compositeNodeId: z.string().min(1) })
  .strict();

export const unpackCompositeTool: AssistantTool = {
  name: "unpack_composite",
  description:
    "Replace a composite node with its expanded inner subgraph. Use to make a recipe's internals editable on canvas. Returns { changed: ['__bulk'], bulk: { compositeRemoved, spawnedNodeCount, spawnedEdgeCount } } — quote spawnedNodeCount + the recipe name before claiming the unpack landed.",
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
    const compositeConfig = (node.config ?? {}) as Record<string, unknown>;
    const beforeNodeCount = ws.nodes.length;
    const beforeEdgeCount = ws.edges.length;
    unpackComposite(args.compositeNodeId);
    const after = useWorkflowStore.getState();
    const spawnedNodeCount = Math.max(0, after.nodes.length - beforeNodeCount + 1);
    const spawnedEdgeCount = Math.max(0, after.edges.length - beforeEdgeCount);
    return {
      ok: true,
      changed: ["__bulk"],
      bulk: {
        compositeRemoved: args.compositeNodeId,
        recipeName: typeof compositeConfig.recipeName === "string" ? compositeConfig.recipeName : null,
        recipeVersion: typeof compositeConfig.recipeVersion === "number" ? compositeConfig.recipeVersion : null,
        spawnedNodeCount,
        spawnedEdgeCount,
      },
    };
  },
};
