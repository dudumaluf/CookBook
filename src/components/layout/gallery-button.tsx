"use client";

import { Images } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * GalleryButton
 *
 * Floating circular icon pill that opens the gallery drawer. Designed to sit
 * in the top-right cluster next to AddNodeButton — same backdrop / border /
 * shadow language so the two read as a grouped pair.
 */
export function GalleryButton() {
  const { galleryOpen, toggleGallery } = useLayoutStore();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleGallery}
          aria-label="Open gallery"
          aria-pressed={galleryOpen}
          className="pointer-events-auto h-9 w-9 rounded-full border border-border/80 bg-popover/95 text-muted-foreground shadow-lg shadow-black/30 backdrop-blur-md hover:bg-popover hover:text-foreground data-[state=on]:text-foreground"
        >
          <Images className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Gallery (⌘G)</TooltipContent>
    </Tooltip>
  );
}
