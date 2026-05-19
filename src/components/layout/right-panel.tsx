"use client";

import { Sliders, ChevronsRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/lib/stores/layout-store";

export function RightPanel() {
  const { rightPanelOpen, toggleRightPanel } = useLayoutStore();

  if (!rightPanelOpen) {
    return (
      <aside className="flex w-9 shrink-0 flex-col items-center gap-1 border-l border-border bg-sidebar py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={toggleRightPanel}
              aria-label="Open properties panel"
            >
              <Sliders className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Properties (⌘2)</TooltipContent>
        </Tooltip>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Properties"
      className="flex w-[320px] shrink-0 flex-col border-l border-border bg-sidebar"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sliders className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Properties</span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleRightPanel}
              className="h-6 w-6 text-muted-foreground"
              aria-label="Collapse properties panel"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Collapse (⌘2)</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col items-start gap-1.5 px-3 py-4">
          <p className="text-sm text-foreground/80">No selection</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Select a node on the canvas to edit its properties and history.
          </p>
        </div>
      </ScrollArea>
    </aside>
  );
}
