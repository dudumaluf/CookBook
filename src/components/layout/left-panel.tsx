"use client";

import { Library, ChevronsLeft, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/lib/stores/layout-store";

export function LeftPanel() {
  const { leftPanelOpen, toggleLeftPanel } = useLayoutStore();

  if (!leftPanelOpen) {
    return (
      <aside className="flex w-9 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={toggleLeftPanel}
              aria-label="Open library panel"
            >
              <Library className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Library (⌘1)</TooltipContent>
        </Tooltip>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Library"
      className="flex w-[280px] shrink-0 flex-col border-r border-border bg-sidebar"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
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
                onClick={toggleLeftPanel}
                className="h-6 w-6 text-muted-foreground"
                aria-label="Collapse library panel"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse (⌘1)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col items-start gap-1.5 px-3 py-4">
          <p className="text-sm text-foreground/80">No assets yet</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Click + to import images, train a Soul ID character, or add a
            moodboard.
          </p>
        </div>
      </ScrollArea>
    </aside>
  );
}
