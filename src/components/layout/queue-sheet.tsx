"use client";

import { Activity, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * QueueSheet
 *
 * Anchored under the top bar, top-right of the canvas area. Shows active jobs
 * (thumbnails + progress) at top, then recent completed (last 10).
 *
 * Day 1: empty state. M0a will wire the execution store to populate this.
 */
export function QueueSheet() {
  const { queueSheetOpen, setQueueSheetOpen } = useLayoutStore();

  if (!queueSheetOpen) return null;

  return (
    <div
      role="dialog"
      aria-label="Execution queue"
      className="pointer-events-auto absolute right-4 top-4 z-40 flex w-[380px] flex-col rounded-2xl border border-border/80 bg-popover/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
      style={{ maxHeight: "min(70vh, 560px)" }}
    >
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">Queue</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          onClick={() => setQueueSheetOpen(false)}
          aria-label="Close queue"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="flex flex-col items-start gap-2 px-4 py-6">
          <p className="text-sm text-foreground/80">No executions yet</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Running and completed jobs will appear here with thumbnails, cost,
            and elapsed time.
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
