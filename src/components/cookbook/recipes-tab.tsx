"use client";

import { Globe, Lock, Package, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { RecipeDetail } from "@/components/cookbook/recipe-detail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSession } from "@/lib/auth/use-session";
import { useRecipes } from "@/lib/hooks/use-recipes";
import type { RecipeRecord } from "@/lib/repositories/recipe-repository";
import { cn } from "@/lib/utils";

type OwnershipFilter = "all" | "system" | "yours";

const FILTER_DEFS: { id: OwnershipFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "system", label: "System" },
  { id: "yours", label: "Yours" },
];

/**
 * RecipesTab — Cookbook Library Phase A.
 *
 * Two-column layout:
 *   Left  — search input + ownership filter chips + recipe card list.
 *   Right — recipe detail panel (when a recipe is selected) or an
 *           empty-state hint asking the user to pick a recipe.
 *
 * Ownership-aware filters mirror the database: System (`owner_id IS
 * NULL`), Yours (`owner_id = me`), All (both). Search runs against
 * name + description + category, case-insensitive.
 *
 * The selected recipe id lives in component state — closing + reopening
 * the Cookbook resets it. Premium-UI principle "quiet by default":
 * no badges or version chips on the cards unless the recipe has a
 * non-default version (Phase B will use this).
 */
export function RecipesTab() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const { data: recipes, isLoading, refresh } = useRecipes();
  const [filter, setFilter] = useState<OwnershipFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filteredRecipes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (filter === "system" && r.ownerId !== null) return false;
      if (filter === "yours" && r.ownerId === null) return false;
      if (!q) return true;
      const haystack = `${r.name} ${r.description ?? ""} ${r.category ?? ""}`
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [recipes, filter, query]);

  // Auto-select the first recipe whenever the filter / query lands on a
  // non-empty list and nothing is selected yet (or the previous selection
  // got filtered out). Keeps the right pane informative on first open.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (filteredRecipes.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const stillVisible = filteredRecipes.some((r) => r.id === selectedId);
    if (!stillVisible) setSelectedId(filteredRecipes[0]!.id);
  }, [filteredRecipes, selectedId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectedRecipe = useMemo(
    () => filteredRecipes.find((r) => r.id === selectedId) ?? null,
    [filteredRecipes, selectedId],
  );

  return (
    <div className="grid h-full grid-cols-[minmax(280px,360px)_1fr] gap-0 overflow-hidden">
      {/* Left — list */}
      <aside className="flex h-full flex-col border-r border-border/60">
        <div className="flex flex-col gap-2 border-b border-border/40 p-3">
          <div className="flex items-center gap-2 rounded-md border border-border/80 bg-background px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search recipes…"
              aria-label="Search recipes"
              className="h-8 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center gap-1">
            {FILTER_DEFS.map((f) => (
              <Button
                key={f.id}
                variant="ghost"
                size="sm"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cn(
                  "h-7 rounded-full px-2.5 text-[11px]",
                  filter === f.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </Button>
            ))}
            <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground/70">
              {filteredRecipes.length} {filteredRecipes.length === 1 ? "recipe" : "recipes"}
            </span>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-1 p-2">
            {isLoading ? (
              <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                Loading recipes…
              </p>
            ) : filteredRecipes.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                {query.trim() || filter !== "all"
                  ? "No matching recipes."
                  : "No recipes yet. Save your first one from the canvas."}
              </p>
            ) : (
              filteredRecipes.map((r) => (
                <RecipeCard
                  key={r.id}
                  recipe={r}
                  selected={r.id === selectedId}
                  onSelect={() => setSelectedId(r.id)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* Right — detail */}
      <section className="flex h-full flex-col overflow-hidden">
        {selectedRecipe ? (
          <RecipeDetail
            recipe={selectedRecipe}
            userId={userId}
            onChanged={() => void refresh()}
          />
        ) : (
          <DetailEmptyState />
        )}
      </section>
    </div>
  );
}

function RecipeCard({
  recipe,
  selected,
  onSelect,
}: {
  recipe: RecipeRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const isSystem = recipe.ownerId === null;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`cookbook-recipe-card-${recipe.id}`}
      className={cn(
        "group flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-border bg-muted/60"
          : "border-transparent bg-transparent hover:bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2">
        <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-xs font-medium text-foreground">
          {recipe.name}
        </span>
        {isSystem ? (
          <Globe
            className="h-3 w-3 shrink-0 text-muted-foreground/70"
            aria-label="System recipe"
          />
        ) : (
          <Lock
            className="h-3 w-3 shrink-0 text-emerald-500/80"
            aria-label="Your recipe"
          />
        )}
      </div>
      <p className="line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
        {recipe.description ??
          `${recipe.subgraph.nodes.length} internal nodes · ${
            recipe.category ?? "uncategorized"
          }`}
      </p>
    </button>
  );
}

function DetailEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center">
      <Package className="h-7 w-7 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        Select a recipe on the left to see what it does.
      </p>
      <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground/70">
        Each recipe shows its inputs, outputs, parameters, internal structure,
        and the prompts inside it. Drop on canvas, duplicate to your library,
        or copy any prompt as plain text to refine elsewhere.
      </p>
    </div>
  );
}
