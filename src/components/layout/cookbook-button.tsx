"use client";

import { BookOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * CookbookButton — Cookbook Library Phase A entry point.
 *
 * Floating circular icon pill. Sits in the top-right cluster
 * immediately before GalleryButton — same backdrop / border / shadow
 * language so it reads as part of the same grouped row.
 *
 * Cluster reading order (left → right): Cookbook (recipes + prompts
 * library) → Gallery (past results) → Run (kick off) → Add Node (extend).
 * Reads as a workflow sentence: discover → review → execute → grow.
 *
 * Uses the BookOpen icon — semantic for "open the cookbook" while
 * staying visually distinct from Gallery's `Images` icon at small sizes.
 */
export function CookbookButton() {
  const cookbookOpen = useLayoutStore((s) => s.cookbookOpen);
  const toggleCookbook = useLayoutStore((s) => s.toggleCookbook);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleCookbook}
          aria-label="Open Cookbook Library"
          aria-pressed={cookbookOpen}
          data-testid="cookbook-button"
          className="pointer-events-auto h-9 w-9 rounded-full border border-border/80 bg-popover/95 text-muted-foreground shadow-lg shadow-black/30 backdrop-blur-md hover:bg-popover hover:text-foreground data-[state=on]:text-foreground"
        >
          <BookOpen className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Cookbook · recipes &amp; prompts (⌘B)</TooltipContent>
    </Tooltip>
  );
}
