"use client";

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * CommandPalette
 *
 * Cmd+K palette for global actions: recipes, navigation, asset search, settings.
 *
 * Day 1: scaffolding only. Wired to actual actions in M0a (recipes + search) and
 * M0d (settings).
 */
export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useLayoutStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (commandPaletteOpen) {
      // Defer focus until after dialog mount + animation.
      const id = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(id);
    }
  }, [commandPaletteOpen]);

  return (
    <Dialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>
            Search recipes, assets, and actions. Type to filter.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search recipes, assets, actions..."
            aria-label="Search"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border/80 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div className="px-4 py-8 text-center">
          <p className="text-sm text-foreground/80">Coming in M0a</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Will search recipes, assets, and actions. Run with{" "}
            <kbd className="rounded border border-border/80 bg-muted px-1 py-0.5 font-mono text-[10px]">
              ↵
            </kbd>
            , navigate with{" "}
            <kbd className="rounded border border-border/80 bg-muted px-1 py-0.5 font-mono text-[10px]">
              ↑
            </kbd>{" "}
            <kbd className="rounded border border-border/80 bg-muted px-1 py-0.5 font-mono text-[10px]">
              ↓
            </kbd>
            .
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
