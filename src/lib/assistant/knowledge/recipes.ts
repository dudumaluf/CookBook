import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import type { RecipeRecord } from "@/lib/repositories/recipe-repository";

/**
 * Knowledge dimension: recipe catalog — Slice 7.2 (ADR-0041).
 *
 * Lists every recipe (own + system) the user has access to, with
 * the public-surface I/O so the assistant can pick one and wire it
 * up. The composite-vs-expand mode (`isNode`) is shown so the
 * assistant knows whether dropping it spawns a single composite
 * node or expands the whole subgraph.
 *
 * Format:
 *   ## RECIPES (4 recipes)
 *
 *   ### `recipe-uuid-1` Soul Image Burst (composite)
 *   Generate 4 photorealistic variations of your trained Soul ID...
 *   Inputs: `prompt: text`, `soulId: soul-id`
 *   Outputs: `out: image`
 *
 *   ### `recipe-uuid-2` Image Describer (composite)
 *   ...
 *
 * The full subgraph isn't included — too verbose. The assistant
 * calls `read_recipe(id)` when it needs internals (Slice 7.2 read
 * tool).
 */

const RECIPE_LIMIT = 30;

function formatExposed(
  handles: NonNullable<RecipeRecord["subgraph"]["exposedInputs"]> | [],
): string {
  if (handles.length === 0) return "_(none)_";
  return handles.map((h) => `\`${h.label}: ${h.dataType}\``).join(", ");
}

function formatRecipe(r: RecipeRecord): string {
  const mode = r.isNode ? "composite" : "expand";
  const desc = r.description ?? "_(no description)_";
  const ins = formatExposed(r.subgraph.exposedInputs ?? []);
  const outs = formatExposed(r.subgraph.exposedOutputs ?? []);
  return [
    `### \`${r.id}\` ${r.name} (${mode})`,
    desc,
    `Inputs: ${ins}`,
    `Outputs: ${outs}`,
  ].join("\n");
}

export async function buildRecipeCatalogKnowledge(
  ownerId: string,
): Promise<string> {
  let recipes: RecipeRecord[];
  try {
    recipes = await getRecipeRepository().list({
      ownerId,
      includeSystem: true,
      limit: RECIPE_LIMIT,
    });
  } catch (err) {
    console.warn("[knowledge/recipes] list failed:", err);
    return `## RECIPES\n_(failed to load recipe catalog)_`;
  }

  if (recipes.length === 0) {
    return `## RECIPES\n_(no recipes — none saved or seeded yet)_`;
  }

  const sections: string[] = [`## RECIPES (${recipes.length} available)`];
  for (const r of recipes) sections.push(formatRecipe(r));
  return sections.join("\n\n");
}
