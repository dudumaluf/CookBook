"use client";

import { Activity, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * QueuePanel
 *
 * Floating right panel mirroring the LibraryPanel geometry: vertically
 * centered, max ~70vh. The activity icon itself conveys state (amber when
 * the queue is active in M0a; muted otherwise) so we no longer carry a
 * separate dot indicator next to it.
 */
export function QueuePanel() {
  const { queueOpen, toggleQueue } = useLayoutStore();

  // M0a wires these from execution store.
  const runningCount = 0;
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
            className="pointer-events-auto absolute right-3 top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full border-border/70 bg-popover/95 shadow-lg shadow-black/30 backdrop-blur-md"
          >
            <Activity
              className={`h-4 w-4 ${
                isActive ? "text-accent" : "text-muted-foreground"
              }`}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Queue (⌘2)</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <aside
      aria-label="Execution queue"
      className="pointer-events-auto absolute right-3 top-1/2 z-20 flex w-[320px] -translate-y-1/2 flex-col rounded-2xl border border-border/70 bg-popover/95 shadow-xl shadow-black/30 backdrop-blur-md"
      style={{ height: "min(70vh, 640px)" }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Activity
            className={`h-3.5 w-3.5 ${
              isActive ? "text-accent" : "text-muted-foreground"
            }`}
          />
          <span>Queue</span>
          <span className="text-xs font-normal text-muted-foreground">
            {isActive ? `${runningCount} running` : "idle"}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleQueue}
              className="h-6 w-6 text-muted-foreground"
              aria-label="Close queue"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close (⌘2)</TooltipContent>
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
