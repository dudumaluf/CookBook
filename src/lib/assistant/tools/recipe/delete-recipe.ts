import { z } from "zod";

import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";

import type { AssistantTool } from "../index";

/**
 * delete_recipe — Tier 1.3 (2026-06-03).
 *
 * Drop a recipe row from `cookbook_recipes`. Cookbook Library shipped
 * the read-only browse + edit-and-save flow, but the assistant
 * couldn't delete a recipe over chat — only the user could click the
 * trash icon in the Library modal. This closes that gap so "delete
 * the v3 'Storyboard Director' duplicate I made by accident" works
 * via chat.
 *
 * RLS does the actual permission check at the DB layer (only the
 * recipe's `ownerId` can delete). The tool surfaces repo errors as
 * `{ ok: false, error }` so the LLM can ask the user to switch
 * accounts or pick a different recipe instead of crashing the loop.
 */

const argsSchema = z.object({ recipeId: z.string().min(1) }).strict();

export const deleteRecipeTool: AssistantTool = {
  name: "delete_recipe",
  description:
    "Delete a user-owned recipe row by id. Cannot delete system recipes (ownerId === null) — RLS will reject. Returns { ok: false, error } on permission denied / not found. Recipe versions in cookbook_recipe_versions are NOT cascaded by this tool — leave a paper trail.",
  parameters: {
    type: "object",
    properties: {
      recipeId: { type: "string" },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    try {
      await getRecipeRepository().remove(args.recipeId);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },
};
