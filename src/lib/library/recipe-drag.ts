/**
 * Drag-and-drop contract from a Library recipe card onto the canvas
 * (Slice 6.6).
 *
 * Parallel to `asset-drag.ts` and `generation-drag.ts` — different MIME
 * + payload, same handler shape on the canvas side. Carries only the
 * recipe id, not the subgraph itself: the canvas-side onDrop fetches
 * the full recipe via `RecipeRepository.get(id)` so we don't bloat the
 * drag payload with what could be a large JSONB blob.
 */

export const RECIPE_DRAG_MIME = "application/x-cookbook-recipe";

export interface RecipeDragPayload {
  recipeId: string;
  /** "node" -> spawn one composite node. "expand" -> instantiate the
   *  subgraph as raw nodes on canvas (legacy mode, kept for recipes
   *  saved with `is_node === false`). */
  mode: "node" | "expand";
}

export function serializeRecipeDrag(payload: RecipeDragPayload): string {
  return JSON.stringify(payload);
}

export function parseRecipeDrag(raw: string): RecipeDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.recipeId !== "string" ||
      obj.recipeId.length === 0 ||
      (obj.mode !== "node" && obj.mode !== "expand")
    ) {
      return null;
    }
    return { recipeId: obj.recipeId, mode: obj.mode };
  } catch {
    return null;
  }
}
