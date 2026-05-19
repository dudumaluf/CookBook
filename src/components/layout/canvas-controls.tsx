"use client";

import { Images } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * CanvasControls
 *
 * Small floating cluster anchored bottom-right of the canvas. Holds the
 * lightweight, always-available controls (gallery, theme). Zoom/fit will join
 * here when React Flow lands in M0a.
 *
 * Visually a thin pill row with breathing room around it, matching the
 * library/queue panel style.
 */
export function CanvasControls() {
  const { galleryOpen, toggleGallery, queueOpen } = useLayoutStore();
  // Shift left when the queue panel is occupying the right column.
  const right = queueOpen ? "calc(320px + 1.5rem)" : "0.75rem";

  return (
    <div
      className="pointer-events-auto absolute bottom-3 z-20 flex items-center gap-1 rounded-full border border-border/80 bg-popover/95 p-1 shadow-lg shadow-black/30 backdrop-blur-md transition-[right] duration-200"
      style={{ right }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleGallery}
            aria-label="Open gallery"
            aria-pressed={galleryOpen}
            className="h-7 w-7 rounded-full text-muted-foreground hover:bg-muted/50 data-[state=on]:text-foreground"
          >
            <Images className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Gallery (⌘G)</TooltipContent>
      </Tooltip>
      <ThemeToggle />
    </div>
  );
}
