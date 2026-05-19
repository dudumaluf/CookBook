"use client";

import { Activity, ChevronsRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * QueuePanel
 *
 * Always-visible floating right panel showing in-flight + recent executions.
 * Day 1 is empty; M0a wires execution store. Collapsed = circular pill in
 * top-right (with breathing).
 *
 * The dot indicator in the header lights up (amber accent) when there's
 * active work; otherwise it's muted.
 */
export function QueuePanel() {
  const { queueOpen, toggleQueue } = useLayoutStore();

  // M0a wires these from execution store.
  const runningCount = 0;
  const totalCost = 0;
  const isActive = runningCount > 0;

  if (!queueOpen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={toggleQueue}
            aria-label="Open queue"
            className="pointer-events-auto absolute right-3 top-16 z-20 h-9 w-9 rounded-full border-border/80 bg-popover/95 shadow-lg shadow-black/30 backdrop-blur-md"
          >
            <Activity
              className={`h-4 w-4 ${
                isActive ? "text-accent" : "text-muted-foreground"
              }`}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Queue</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <aside
      aria-label="Execution queue"
      className="pointer-events-auto absolute bottom-3 right-3 top-16 z-20 flex w-[320px] flex-col rounded-2xl border border-border/80 bg-popover/95 shadow-xl shadow-black/30 backdrop-blur-md"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isActive ? "bg-accent" : "bg-muted-foreground/40"
            }`}
            aria-hidden
          />
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Queue</span>
          {isActive ? (
            <span className="text-xs font-normal text-muted-foreground">
              {runningCount} running · ${totalCost.toFixed(2)}
            </span>
          ) : (
            <span className="text-xs font-normal text-muted-foreground">
              idle
            </span>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleQueue}
              className="h-6 w-6 text-muted-foreground"
              aria-label="Collapse queue"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Collapse</TooltipContent>
        </Tooltip>
      </header>

      <ScrollArea className="flex-1">
        <div className="flex flex-col items-start gap-1.5 px-3 py-4">
          <p className="text-sm text-foreground/80">No executions yet</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Running and completed jobs land here with thumbnails, cost, and
            elapsed time.
          </p>
        </div>
      </ScrollArea>
    </aside>
  );
}
