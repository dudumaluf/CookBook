"use client";

import { Package, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  RECIPE_DRAG_MIME,
  serializeRecipeDrag,
} from "@/lib/library/recipe-drag";
import type { RecipeRecord } from "@/lib/repositories/recipe-repository";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";

/**
 * Recipe card — Slice 6.6.
 *
 * Renders a single recipe in the Library's "Recipes" section. Drag onto
 * canvas to spawn a composite node (or to expand the subgraph as raw
 * nodes, depending on `recipe.isNode`). System recipes (owner_id null)
 * show a small "system" tag and don't expose a delete button.
 *
 * Visual: same compact 2-col grid card style as the existing
 * AssetCard so the library reads as one consistent surface.
 */

export function RecipeCard({
  recipe,
  onChanged,
}: {
  recipe: RecipeRecord;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const isSystem = recipe.ownerId === null;

  return (
    <div
      data-testid="recipe-card"
      data-recipe-id={recipe.id}
      role="button"
      tabIndex={0}
      draggable
      title={`Drag to canvas to ${recipe.isNode ? "spawn a composite node" : "expand into nodes"}: ${recipe.description ?? "no description"}`}
      onDragStart={(e) => {
        e.dataTransfer.setData(
          RECIPE_DRAG_MIME,
          serializeRecipeDrag({
            recipeId: recipe.id,
            mode: recipe.isNode ? "node" : "expand",
          }),
        );
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="group relative flex flex-col gap-1 overflow-hidden rounded-lg border border-border/60 bg-card/60 px-2 py-2 transition-colors hover:border-border"
    >
      <div className="flex items-center gap-1.5">
        <Package className="h-3 w-3 shrink-0 text-muted-foreground" />
        <p
          className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-foreground/85"
          title={recipe.name}
        >
          {recipe.name}
        </p>
        {isSystem ? (
          <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
            system
          </span>
        ) : null}
      </div>
      {recipe.description ? (
        <p className="line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/80">
          {recipe.description}
        </p>
      ) : null}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/60">
          {recipe.subgraph.nodes.length} nodes ·{" "}
          {recipe.isNode ? "composite" : "expand"}
        </span>
        {!isSystem ? (
          <button
            type="button"
            aria-label={`Delete recipe ${recipe.name}`}
            disabled={busy}
            onClick={async (e) => {
              e.stopPropagation();
              if (
                !window.confirm(
                  `Delete recipe "${recipe.name}"? This can't be undone.`,
                )
              ) {
                return;
              }
              setBusy(true);
              try {
                await getRecipeRepository().remove(recipe.id);
                onChanged();
                toast.success(`Deleted recipe "${recipe.name}"`);
              } catch (err) {
                console.warn("[recipe-card] delete failed:", err);
                toast.error("Could not delete recipe");
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
