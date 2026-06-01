import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import type { RecipeRecord } from "@/lib/repositories/recipe-repository";

/**
 * forkRecipe — Cookbook Library Phase B1 (ADR-0051).
 *
 * Creates a user-owned copy of a recipe (system OR user) and returns the
 * new record. The fork:
 *   - inherits subgraph, description, category, and isNode from the
 *     source unchanged;
 *   - sets `parentRecipeId = source.id` so the lineage is queryable
 *     (history view, "show siblings" in a future phase);
 *   - sets `ownerId = userId` so the fork is editable by this user only;
 *   - resets `version` implicitly to 1 (the DB default; the column is
 *     not in the `save` payload, so a fresh row always starts at v1).
 *
 * Naming: the caller passes a `nameSuffix` so the same helper covers
 *   - explicit duplicate flow → " (copy)"
 *   - silent fork-on-edit flow → " (your copy)"
 *
 * Phase B1 calls this in two places:
 *   1. `recipe-detail.tsx` `handleDuplicate` — explicit user duplicate.
 *   2. `recipe-edit-session.ts` `openRecipeForEdit` — silent fork when
 *      the user clicks Edit on a system recipe; the caller then
 *      navigates to the fork's edit route.
 */
export interface ForkRecipeInput {
  source: RecipeRecord;
  ownerId: string;
  /** Suffix appended to the source's name. Default ` (copy)`. */
  nameSuffix?: string;
}

export async function forkRecipe(input: ForkRecipeInput): Promise<RecipeRecord> {
  const suffix = input.nameSuffix ?? " (copy)";
  return getRecipeRepository().save({
    ownerId: input.ownerId,
    name: `${input.source.name}${suffix}`,
    description: input.source.description,
    category: input.source.category,
    subgraph: input.source.subgraph,
    isNode: input.source.isNode,
    parentRecipeId: input.source.id,
  });
}
