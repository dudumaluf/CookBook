"use client";

import { ScrollText, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * LogsPanel
 *
 * Dev-tool overlay anchored to the right edge, full-height. Toggle with
 * Cmd+Shift+L. Kept out of normal flow because logs are noise 99% of the time.
 *
 * Day 1: empty placeholder. M0a will stream engine + service logs here.
 */
export function LogsPanel() {
  const { logsPanelOpen, setLogsPanelOpen } = useLayoutStore();

  if (!logsPanelOpen) return null;

  return (
    <aside
      role="dialog"
      aria-label="Logs panel"
      className="pointer-events-auto absolute right-0 top-0 z-50 flex h-full w-[420px] flex-col border-l border-border bg-popover/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
    >
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">Logs</span>
          <span className="text-xs text-muted-foreground">dev</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          onClick={() => setLogsPanelOpen(false)}
          aria-label="Close logs"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <pre className="px-3 py-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {"// Engine + service logs will stream here.\n// Toggle with \u2318\u21E7L."}
        </pre>
      </ScrollArea>
    </aside>
  );
}
