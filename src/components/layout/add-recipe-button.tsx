"use client";

import { BookOpen, ChevronDown, Package, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useRecipes } from "@/lib/hooks/use-recipes";
import {
  type RecipeCategory,
  type RecipeRecord,
} from "@/lib/repositories/recipe-repository";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { getSpawnPosition } from "@/lib/canvas/spawn-position";

/**
 * AddRecipeButton — the recipe half of the old AddNodeButton, split into its
 * own top-right pill (sibling of AddNodeButton) so single nodes and recipe
 * nodes live behind separate buttons. Spawns a `composite` node from a saved
 * recipe; AddNodeButton now only spawns single registry nodes.
 *
 * Mirrors AddNodeButton's pill language and popover chrome; only the body
 * differs (recipe buckets + ownership filter + "manage all in Cookbook").
 */

/**
 * Display order + labels for the recipe category buckets. `null` is the
 * fallback bucket for legacy recipes whose `category` doesn't coerce to a
 * known value (`coerceRecipeCategory` returns null on unknown DB strings).
 */
const RECIPE_CATEGORY_LABELS: { id: RecipeCategory | null; label: string }[] = [
  { id: "describe", label: "describe" },
  { id: "image", label: "image" },
  { id: "video", label: "video" },
  { id: "audio", label: "audio" },
  { id: "utility", label: "utility" },
  { id: null, label: "uncategorized" },
];

type RecipeFilterMode = "all" | "system" | "mine";

const RECIPE_FILTER_MODES: { id: RecipeFilterMode; label: string }[] = [
  { id: "all", label: "All" },
  { id: "system", label: "System" },
  { id: "mine", label: "Yours" },
];

export function AddRecipeButton() {
  const { addRecipePopoverOpen, setAddRecipePopoverOpen } = useLayoutStore();
  const toggleCookbook = useLayoutStore((s) => s.toggleCookbook);
  const addWorkflowNode = useWorkflowStore((s) => s.addNode);
  const nodeCount = useWorkflowStore((s) => s.nodes.length);
  const [query, setQuery] = useState("");
  const [recipeFilter, setRecipeFilter] = useState<RecipeFilterMode>("all");
  /** Per-category collapse state. Empty set = all expanded. */
  const [collapsed, setCollapsed] = useState<Set<RecipeCategory | null>>(
    () => new Set(),
  );

  const { data: recipes, refresh: refreshRecipes } = useRecipes();

  /**
   * Recipes that pass BOTH the search query AND the ownership filter.
   * `system` = `ownerId === null`, `mine` = the inverse (the `useRecipes`
   * hook already scopes the listing to the signed-in user).
   */
  const filteredRecipes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (recipeFilter === "system" && r.ownerId !== null) return false;
      if (recipeFilter === "mine" && r.ownerId === null) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [recipes, query, recipeFilter]);

  /** Recipes grouped by category, in display order; empty buckets dropped. */
  const recipesByCategory = useMemo(() => {
    const buckets = new Map<RecipeCategory | null, RecipeRecord[]>();
    for (const r of filteredRecipes) {
      const list = buckets.get(r.category) ?? [];
      list.push(r);
      buckets.set(r.category, list);
    }
    return RECIPE_CATEGORY_LABELS.map((row) => ({
      ...row,
      recipes: buckets.get(row.id) ?? [],
    })).filter((row) => row.recipes.length > 0);
  }, [filteredRecipes]);

  function toggleCategory(id: RecipeCategory | null) {
    setCollapsed((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handlePickRecipe(recipeId: string) {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    // Spawn at the current viewport center (in flow coords) with a small
    // diagonal jitter per existing node so consecutive picks of the same
    // recipe don't perfectly stack.
    const center = getSpawnPosition();
    const jitter = (nodeCount % 5) * 24;
    addWorkflowNode(
      "composite",
      { x: center.x + jitter, y: center.y + jitter },
      {
        recipeId: recipe.id,
        recipeName: recipe.name,
        recipeVersion: recipe.version,
        subgraph: recipe.subgraph,
        exposedInputs: recipe.subgraph.exposedInputs ?? [],
        exposedOutputs: recipe.subgraph.exposedOutputs ?? [],
        exposedParams: recipe.subgraph.exposedParams ?? [],
      },
    );
    setAddRecipePopoverOpen(false);
    setQuery("");
  }

  async function handleDeleteRecipe(recipeId: string, name: string) {
    if (!window.confirm(`Delete recipe "${name}"? This can't be undone.`)) return;
    try {
      await getRecipeRepository().remove(recipeId);
      await refreshRecipes();
      toast.success(`Deleted recipe "${name}"`);
    } catch (err) {
      console.warn("[add-recipe] delete recipe failed:", err);
      toast.error("Could not delete recipe");
    }
  }

  function handleViewAll() {
    setAddRecipePopoverOpen(false);
    toggleCookbook();
  }

  const noMatches =
    query.trim().length > 0 && filteredRecipes.length === 0;

  return (
    <Popover open={addRecipePopoverOpen} onOpenChange={setAddRecipePopoverOpen}>
      <PopoverTrigger
        aria-label="Add a recipe"
        className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-border/80 bg-popover/95 px-3 text-sm text-foreground shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-popover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <Package className="h-3.5 w-3.5" />
        <span>Add recipe</span>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-[340px] p-0"
      >
        <div className="border-b border-border/60 p-2">
          <div className="flex items-center gap-2 rounded-md border border-border/80 bg-background px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="Search recipes…"
              aria-label="Search recipes"
              className="h-8 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
        <ScrollArea className="h-[360px]">
          <div className="flex flex-col gap-1 p-2" data-testid="add-recipe-list">
            <div className="flex items-center justify-between gap-2 px-2 pt-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Recipes ({filteredRecipes.length})
              </span>
              <div
                className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background/40 p-0.5"
                role="tablist"
                aria-label="Filter recipes by ownership"
              >
                {RECIPE_FILTER_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={recipeFilter === m.id}
                    onClick={() => setRecipeFilter(m.id)}
                    data-testid={`add-recipe-filter-${m.id}`}
                    className={
                      "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors " +
                      (recipeFilter === m.id
                        ? "bg-foreground/[0.08] text-foreground"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {recipes.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                No recipes yet. Save a selection as a recipe, or browse the
                Cookbook (⌘B).
              </p>
            ) : noMatches ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                No recipes match &quot;{query}&quot;.
              </p>
            ) : filteredRecipes.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-muted-foreground/70">
                No recipes match this filter.
              </p>
            ) : null}

            {recipesByCategory.map((bucket) => {
              const isCollapsed = collapsed.has(bucket.id);
              return (
                <div
                  key={bucket.id ?? "uncategorized"}
                  className="flex flex-col gap-0.5"
                  data-testid={`add-recipe-bucket-${bucket.id ?? "null"}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleCategory(bucket.id)}
                    aria-expanded={!isCollapsed}
                    className="group flex items-center gap-1 px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 hover:text-foreground"
                  >
                    <ChevronDown
                      className={
                        "h-3 w-3 transition-transform " +
                        (isCollapsed ? "-rotate-90" : "")
                      }
                      aria-hidden
                    />
                    <span>
                      {bucket.label} ({bucket.recipes.length})
                    </span>
                  </button>
                  {!isCollapsed
                    ? bucket.recipes.map((recipe) => {
                        const isSystem = recipe.ownerId === null;
                        return (
                          <div
                            key={recipe.id}
                            className="group/recipe relative flex items-center"
                          >
                            <Button
                              variant="ghost"
                              onClick={() => handlePickRecipe(recipe.id)}
                              data-testid={`add-recipe-${recipe.id}`}
                              className="h-auto w-full justify-start gap-2 px-2 py-1.5 pr-7 text-left"
                            >
                              <Package className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="flex min-w-0 flex-1 flex-col items-start">
                                <span className="flex w-full items-center gap-1.5">
                                  <span className="truncate text-xs text-foreground">
                                    {recipe.name}
                                  </span>
                                  {isSystem ? (
                                    <span
                                      className="shrink-0 rounded-sm border border-border/50 px-1 py-px text-[8.5px] uppercase tracking-wider text-muted-foreground/70"
                                      aria-label="System recipe"
                                    >
                                      sys
                                    </span>
                                  ) : null}
                                </span>
                                <span className="truncate text-[10px] text-muted-foreground">
                                  {recipe.description ??
                                    `${recipe.subgraph.nodes.length} nodes`}
                                </span>
                              </span>
                            </Button>
                            {!isSystem ? (
                              <button
                                type="button"
                                aria-label={`Delete recipe ${recipe.name}`}
                                onClick={() =>
                                  void handleDeleteRecipe(recipe.id, recipe.name)
                                }
                                className="absolute right-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover/recipe:opacity-100"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            ) : null}
                          </div>
                        );
                      })
                    : null}
                </div>
              );
            })}

            <button
              type="button"
              onClick={handleViewAll}
              data-testid="add-recipe-view-all"
              className="mx-2 mt-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-2 py-1 text-[10.5px] text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
            >
              <BookOpen className="h-3 w-3" />
              Manage all in Cookbook (⌘B)
            </button>
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
