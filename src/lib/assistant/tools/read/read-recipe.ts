import { z } from "zod";

import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";

import type { AssistantTool } from "../index";

/**
 * read_recipe — Slice 7.2 (ADR-0041).
 *
 * Fetch the FULL details of one recipe — name, description, full
 * subgraph (nodes + edges), exposed I/O, isNode flag. Use when the
 * recipe-catalog summary in the system prompt isn't enough — e.g.
 * to inspect what kinds of nodes a recipe contains before deciding
 * whether to instantiate it as composite or expand it.
 */

const argsSchema = z
  .object({
    recipeId: z.string().min(1),
  })
  .strict();

export const readRecipeTool: AssistantTool = {
  name: "read_recipe",
  description:
    "Read the full details of one recipe by id. Returns the full subgraph (nodes + edges), exposed inputs/outputs, isNode mode, and metadata.",
  parameters: {
    type: "object",
    properties: {
      recipeId: {
        type: "string",
        description: "The recipe's uuid as listed in the catalog.",
      },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const { recipeId } = argsSchema.parse(rawArgs);
    const recipe = await getRecipeRepository().get(recipeId);
    if (!recipe) {
      return { found: false, error: `No recipe with id ${recipeId}` };
    }
    return {
      found: true,
      recipe: {
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        category: recipe.category,
        isNode: recipe.isNode,
        ownerId: recipe.ownerId,
        subgraph: recipe.subgraph,
      },
    };
  },
};
