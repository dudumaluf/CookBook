"use client";

import { Book, X } from "lucide-react";
import { useEffect } from "react";

import { PromptsTab } from "@/components/cookbook/prompts-tab";
import { RecipesTab } from "@/components/cookbook/recipes-tab";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLayoutStore, type CookbookTab } from "@/lib/stores/layout-store";

/**
 * CookbookOverlay — Cookbook Library Phase A.
 *
 * Full-screen-ish overlay (94vh × 96vw, max-width 1400px) that opens
 * over the canvas. Two tabs:
 *
 *   - Recipes  — browse, search, drop, duplicate, delete recipes;
 *                inspect their internals.
 *   - Prompts  — every prompt the system uses, with plain-English
 *                descriptions and copy-paste-friendly content.
 *
 * Closes on Esc, on backdrop click, or on the explicit close button.
 * The active tab is persisted to localStorage so reopening the
 * Cookbook lands wherever the user left off.
 *
 * Premium-UI principle "one screen, one job": the overlay never opens
 * sub-modals — every detail is rendered inline in the right pane.
 */
export function CookbookOverlay() {
  const open = useLayoutStore((s) => s.cookbookOpen);
  const setOpen = useLayoutStore((s) => s.setCookbookOpen);
  const tab = useLayoutStore((s) => s.cookbookTab);
  const setTab = useLayoutStore((s) => s.setCookbookTab);

  // Esc closes the overlay (matches Library/Gallery patterns).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="cookbook-overlay"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close Cookbook"
        onClick={() => setOpen(false)}
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm"
      />

      {/* Panel */}
      <section
        aria-label="Cookbook Library"
        className="relative flex h-[94vh] w-[96vw] max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-border/80 bg-popover/95 shadow-2xl shadow-black/50 backdrop-blur-md"
      >
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as CookbookTab)}
          className="flex h-full min-h-0 flex-1 flex-col gap-0"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
            <div className="flex items-center gap-2">
              <Book className="h-4 w-4 text-muted-foreground" aria-hidden />
              <h2 className="text-sm font-medium text-foreground">Cookbook</h2>
              <span className="hidden text-[10.5px] text-muted-foreground/70 sm:inline">
                recipes &amp; prompts library
              </span>
            </div>

            <TabsList variant="default">
              <TabsTrigger value="recipes" data-testid="cookbook-tab-recipes">
                Recipes
              </TabsTrigger>
              <TabsTrigger value="prompts" data-testid="cookbook-tab-prompts">
                Prompts
              </TabsTrigger>
            </TabsList>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close Cookbook"
                  onClick={() => setOpen(false)}
                  className="h-7 w-7 rounded-full"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close (Esc)</TooltipContent>
            </Tooltip>
          </header>

          {/* Body — both panels stay mounted so each preserves its
           *  scroll position when the user toggles between them. */}
          <TabsContent
            value="recipes"
            className="m-0 min-h-0 flex-1 overflow-hidden"
          >
            <RecipesTab />
          </TabsContent>
          <TabsContent
            value="prompts"
            className="m-0 min-h-0 flex-1 overflow-hidden"
          >
            <PromptsTab />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
