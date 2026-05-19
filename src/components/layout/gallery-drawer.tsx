"use client";

import { useEffect } from "react";
import { X, Search, Grid2x2, Grid3x3, LayoutGrid } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * GalleryDrawer
 *
 * Bottom-drawer overlay that takes ~65% of viewport height with a dimmed
 * backdrop. Designed to "celebrate the work": rich thumbnails, hover-to-play,
 * multi-select + spacebar compare, grid-density toggle, filters.
 *
 * Day 1: visual skeleton only (header + density + search + empty state).
 * M0a wires real results from the execution store.
 */
export function GalleryDrawer() {
  const { galleryOpen, setGalleryOpen } = useLayoutStore();

  // Trap focus / close on Esc (closeAllOverlays already handles this for the
  // global Esc; this also enables clicking the backdrop to dismiss).
  useEffect(() => {
    if (!galleryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGalleryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [galleryOpen, setGalleryOpen]);

  if (!galleryOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-stretch">
      <button
        type="button"
        aria-label="Close gallery"
        onClick={() => setGalleryOpen(false)}
        className="flex-1 cursor-default bg-background/60 backdrop-blur-sm"
      />
      <section
        aria-label="Gallery"
        className="flex h-[65vh] flex-col rounded-t-3xl border-t border-border/80 bg-popover/95 shadow-2xl shadow-black/60 backdrop-blur-md"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-1 w-10 rounded-full bg-border"
              aria-hidden
            />
            <h2 className="text-sm font-medium text-foreground">Gallery</h2>
            <span className="text-xs text-muted-foreground">0 items</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="flex items-center gap-1 rounded-full border border-border/80 bg-background px-2">
              <Search className="h-3.5 w-3.5" aria-hidden />
              <Input
                placeholder="Search results…"
                className="h-7 w-48 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="flex items-center gap-0.5 rounded-full border border-border/80 bg-background p-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Sparse grid"
                    className="h-6 w-6 rounded-full"
                  >
                    <Grid2x2 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sparse</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Medium grid"
                    className="h-6 w-6 rounded-full bg-muted/40 text-foreground"
                  >
                    <LayoutGrid className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Medium</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Dense grid"
                    className="h-6 w-6 rounded-full"
                  >
                    <Grid3x3 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Dense</TooltipContent>
              </Tooltip>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close gallery"
                  onClick={() => setGalleryOpen(false)}
                  className="h-7 w-7 rounded-full"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close (Esc)</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center">
          <div className="flex max-w-md flex-col items-center gap-2 text-center">
            <p className="text-sm font-medium text-foreground">
              No results yet
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Once you run a recipe, every image and video lands here. Hover
              thumbnails to preview, Space to compare side-by-side, drag the
              density slider to fit more on screen.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
