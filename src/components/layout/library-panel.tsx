"use client";

import { Library, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * LibraryPanel
 *
 * Floating left panel. Vertically centered, max ~70vh tall (capped at 640px),
 * rounded card with breathing room. Collapses to a vertically-centered
 * circular pill so the toggle stays in the same eye-line as the panel was.
 */
export function LibraryPanel() {
  const { libraryOpen, toggleLibrary } = useLayoutStore();

  if (!libraryOpen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={toggleLibrary}
            aria-label="Open library"
            className="pointer-events-auto absolute left-3 top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full border-border/70 bg-popover/95 shadow-lg shadow-black/30 backdrop-blur-md"
          >
            <Library className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Library (⌘1)</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <aside
      aria-label="Library"
      className="pointer-events-auto absolute left-3 top-1/2 z-20 flex w-[280px] -translate-y-1/2 flex-col rounded-2xl border border-border/70 bg-popover/95 shadow-xl shadow-black/30 backdrop-blur-md"
      style={{ height: "min(70vh, 640px)" }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Library className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Library</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                aria-label="New asset"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New asset</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleLibrary}
                className="h-6 w-6 text-muted-foreground"
                aria-label="Close library"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close (⌘1)</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="flex flex-col items-start gap-1.5 px-3 py-4">
          <p className="text-sm text-foreground/80">No assets yet</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Click <span className="font-medium text-foreground/80">+</span> to
            import images, train a Soul ID character, or add a moodboard. Drag
            from here onto the canvas.
          </p>
        </div>
      </ScrollArea>
    </aside>
  );
}
