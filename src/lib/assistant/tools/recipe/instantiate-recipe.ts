import { z } from "zod";

import { instantiateRecipeOnCanvas } from "@/lib/recipes/instantiate";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * instantiate_recipe — Slice 7.3 (ADR-0042).
 *
 * Drop a saved recipe onto the canvas. Two modes:
 *   - mode: "node" (default for is_node:true recipes) — spawns a
 *     single composite node carrying the captured subgraph in its
 *     config. The composite renders only the recipe's exposed I/O.
 *   - mode: "expand" (default for is_node:false recipes) — instantiates
 *     the recipe as raw nodes on canvas. The user can then edit each
 *     internal node directly.
 *
 * If `mode` is omitted, the tool follows the recipe's `isNode` flag.
 */

const argsSchema = z
  .object({
    recipeId: z.string().min(1),
    position: z
      .object({ x: z.number(), y: z.number() })
      .default({ x: 200, y: 200 }),
    mode: z.enum(["node", "expand"]).optional(),
  })
  .strict();

export const instantiateRecipeTool: AssistantTool = {
  name: "instantiate_recipe",
  description:
    "Drop a saved recipe onto the canvas. Mode 'node' spawns a single composite node (one box with the recipe's exposed I/O); mode 'expand' instantiates all the inner nodes directly. Defaults to the recipe's saved isNode flag.",
  parameters: {
    type: "object",
    properties: {
      recipeId: { type: "string" },
      position: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
        additionalProperties: false,
      },
      mode: {
        type: "string",
        enum: ["node", "expand"],
        description:
          "'node' = composite (one box). 'expand' = raw nodes. Default: follow recipe.isNode.",
      },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const recipe = await getRecipeRepository().get(args.recipeId);
    if (!recipe) {
      return { ok: false, error: `No recipe with id ${args.recipeId}` };
    }
    const mode = args.mode ?? (recipe.isNode ? "node" : "expand");
    if (mode === "node") {
      const id = useWorkflowStore.getState().addNode(
        "composite",
        args.position,
        {
          recipeId: recipe.id,
          recipeName: recipe.name,
          subgraph: recipe.subgraph,
          exposedInputs: recipe.subgraph.exposedInputs ?? [],
          exposedOutputs: recipe.subgraph.exposedOutputs ?? [],
        },
      );
      return { ok: true, mode, compositeNodeId: id };
    }
    const result = instantiateRecipeOnCanvas({
      subgraph: recipe.subgraph,
      position: args.position,
    });
    return { ok: true, mode, spawnedNodeIds: result.nodeIds };
  },
};
