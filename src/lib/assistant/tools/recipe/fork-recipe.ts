import { z } from "zod";

import { forkRecipe } from "@/lib/recipes/fork-recipe";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";

import type { AssistantTool } from "../index";

/**
 * fork_recipe — Tier 1.3 (2026-06-03).
 *
 * Create a user-owned copy of an existing recipe. Mirrors the
 * "Duplicate" affordance in the recipe-detail panel. The fork:
 *   - inherits subgraph, description, category, isNode unchanged;
 *   - sets `parentRecipeId = sourceId` (lineage preserved);
 *   - resets `version` to 1 (fresh edit history).
 *
 * Default name suffix is `" (copy)"` to match the explicit
 * Duplicate flow. The assistant can override via `nameSuffix` —
 * useful for "fork this for a tweaked version" → " (variant)".
 *
 * Requires `ctx.ownerId`. System recipes (ownerId === null) can be
 * forked by anyone; user recipes can only be forked by their owner
 * (RLS at the DB layer).
 */

const argsSchema = z
  .object({
    sourceRecipeId: z.string().min(1),
    nameSuffix: z.string().optional(),
  })
  .strict();

export const forkRecipeTool: AssistantTool = {
  name: "fork_recipe",
  description:
    "Create a user-owned copy of an existing recipe (system or user). Returns the new recipeId. Inherits subgraph + metadata, sets parentRecipeId for lineage, resets version to 1. Default nameSuffix is ' (copy)'.",
  parameters: {
    type: "object",
    properties: {
      sourceRecipeId: { type: "string" },
      nameSuffix: {
        type: "string",
        description:
          "Suffix appended to the source's name. Default ' (copy)'. Use ' (variant)' or similar when forking for an intended tweak.",
      },
    },
    required: ["sourceRecipeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    if (!ctx.ownerId) {
      return { ok: false, error: "no authenticated user" };
    }
    const args = argsSchema.parse(rawArgs);
    const source = await getRecipeRepository().get(args.sourceRecipeId);
    if (!source) {
      return {
        ok: false,
        error: `No recipe with id ${args.sourceRecipeId}`,
      };
    }
    try {
      const fork = await forkRecipe({
        source,
        ownerId: ctx.ownerId,
        nameSuffix: args.nameSuffix,
      });
      return {
        ok: true,
        recipeId: fork.id,
        name: fork.name,
        parentRecipeId: fork.parentRecipeId,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },
};
