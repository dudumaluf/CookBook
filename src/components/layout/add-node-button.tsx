"use client";

import { useMemo, useState } from "react";
import { Package, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import "@/lib/engine/all-nodes";
import { nodeRegistry } from "@/lib/engine/registry";
import { useRecipes } from "@/lib/hooks/use-recipes";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeCategory, NodeSchema } from "@/types/node";

/**
 * Categories shown in the popover. Order is intentional (workflow read order:
 * inputs first, output last). Categories without registered nodes render as
 * "Coming soon" labels so the user can see the planned shape.
 */
const CATEGORY_LABELS: { id: NodeCategory; label: string }[] = [
  { id: "input", label: "Inputs" },
  { id: "iterator", label: "Iterators" },
  { id: "ai-vision", label: "AI · Vision" },
  { id: "ai-text", label: "AI · Text" },
  { id: "ai-image", label: "AI · Image" },
  { id: "ai-video", label: "AI · Video" },
  { id: "transform", label: "Transform" },
  { id: "compose", label: "Compose" },
  { id: "output", label: "Output" },
];

export function AddNodeButton() {
  const { addNodePopoverOpen, setAddNodePopoverOpen } = useLayoutStore();
  const addWorkflowNode = useWorkflowStore((s) => s.addNode);
  const nodeCount = useWorkflowStore((s) => s.nodes.length);
  const [query, setQuery] = useState("");

  const allSchemas = useMemo(() => nodeRegistry.list(), []);
  const { data: recipes, refresh: refreshRecipes } = useRecipes();

  const matchedRecipes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q),
    );
  }, [recipes, query]);

  function handlePickRecipe(recipeId: string) {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const offset = nodeCount * 36;
    addWorkflowNode("composite", { x: 200 + offset, y: 160 + offset }, {
      recipeId: recipe.id,
      recipeName: recipe.name,
      subgraph: recipe.subgraph,
      exposedInputs: recipe.subgraph.exposedInputs ?? [],
      exposedOutputs: recipe.subgraph.exposedOutputs ?? [],
      exposedParams: recipe.subgraph.exposedParams ?? [],
    });
    setAddNodePopoverOpen(false);
    setQuery("");
  }

  async function handleDeleteRecipe(recipeId: string, name: string) {
    if (!window.confirm(`Delete recipe "${name}"? This can't be undone.`)) return;
    try {
      await getRecipeRepository().remove(recipeId);
      await refreshRecipes();
      toast.success(`Deleted recipe "${name}"`);
    } catch (err) {
      console.warn("[add-node] delete recipe failed:", err);
      toast.error("Could not delete recipe");
    }
  }

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? allSchemas.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.description.toLowerCase().includes(q) ||
            n.category.toLowerCase().includes(q),
        )
      : allSchemas;

    const byCategory = new Map<NodeCategory, NodeSchema[]>();
    for (const schema of filtered) {
      const list = byCategory.get(schema.category) ?? [];
      list.push(schema);
      byCategory.set(schema.category, list);
    }
    return byCategory;
  }, [allSchemas, query]);

  function handlePick(schema: NodeSchema) {
    // Cascade placement based on current node count so newcomers are visible
    // and predictable. Slice 2/3 will drop at the actual click coords via the
    // canvas-context-menu hand-off.
    const offset = nodeCount * 36;
    addWorkflowNode(schema.kind, { x: 200 + offset, y: 160 + offset });
    setAddNodePopoverOpen(false);
    setQuery("");
  }

  const matchedCategories = CATEGORY_LABELS.filter(
    (c) => (grouped.get(c.id)?.length ?? 0) > 0,
  );
  const emptyCategories = CATEGORY_LABELS.filter(
    (c) => (grouped.get(c.id)?.length ?? 0) === 0,
  );
  const noMatches =
    query.trim().length > 0 &&
    matchedCategories.length === 0 &&
    matchedRecipes.length === 0;

  return (
    <Popover open={addNodePopoverOpen} onOpenChange={setAddNodePopoverOpen}>
      <PopoverTrigger
        aria-label="Add a node (or right-click the canvas)"
        className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-border/80 bg-popover/95 px-3 text-sm text-foreground shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-popover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <Plus className="h-3.5 w-3.5" />
        <span>Add node</span>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-[320px] p-0"
      >
        <div className="border-b border-border/60 p-2">
          <div className="flex items-center gap-2 rounded-md border border-border/80 bg-background px-2">
            <Search
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="Search nodes…"
              aria-label="Search nodes"
              className="h-8 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
        <ScrollArea className="h-[320px]">
          <div className="flex flex-col gap-1 p-2">
            {noMatches && (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                No matches for &quot;{query}&quot;
              </p>
            )}

            {matchedRecipes.length > 0 ? (
              <div className="flex flex-col gap-0.5" data-testid="add-node-recipes">
                <p className="px-2 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Recipes
                </p>
                {matchedRecipes.map((recipe) => (
                  <div
                    key={recipe.id}
                    className="group/recipe relative flex items-center"
                  >
                    <Button
                      variant="ghost"
                      onClick={() => handlePickRecipe(recipe.id)}
                      data-testid={`add-node-recipe-${recipe.id}`}
                      className="h-auto w-full justify-start gap-2 px-2 py-1.5 pr-7 text-left"
                    >
                      <Package className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="flex min-w-0 flex-1 flex-col items-start">
                        <span className="text-xs text-foreground">
                          {recipe.name}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {recipe.description ??
                            `${recipe.subgraph.nodes.length} nodes`}
                        </span>
                      </span>
                    </Button>
                    {recipe.ownerId !== null ? (
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
                ))}
              </div>
            ) : null}

            {matchedCategories.map((cat) => (
              <div key={cat.id} className="flex flex-col gap-0.5">
                <p className="px-2 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {cat.label}
                </p>
                {grouped.get(cat.id)?.map((schema) => {
                  const Icon = schema.icon;
                  return (
                    <Button
                      key={schema.kind}
                      variant="ghost"
                      onClick={() => handlePick(schema)}
                      className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-left"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="flex min-w-0 flex-1 flex-col items-start">
                        <span className="text-xs text-foreground">
                          {schema.title}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {schema.description}
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            ))}

            {!query.trim() && emptyCategories.length > 0 && (
              <div className="mt-2 flex flex-col gap-0.5 border-t border-border/40 pt-2">
                <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  Coming soon
                </p>
                {emptyCategories.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between px-2 py-1 text-[11px] text-muted-foreground/60"
                  >
                    <span>{cat.label}</span>
                    <span className="rounded-sm border border-border/60 px-1 py-0.5 text-[9px] uppercase tracking-wider">
                      M0a
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
