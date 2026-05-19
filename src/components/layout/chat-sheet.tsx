"use client";

import { MessageSquare, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * ChatSheet
 *
 * Slide-up overlay anchored above the prompt bar. The prompt bar is the sheet's
 * "footer" — when the sheet is open, the user sees history + can keep typing
 * without a context switch.
 *
 * Wired up with real messages in M0a.
 */
export function ChatSheet() {
  const { chatSheetOpen, setChatSheetOpen } = useLayoutStore();

  if (!chatSheetOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Conversation history"
      className="pointer-events-auto flex w-full max-w-[640px] flex-col rounded-2xl border border-border/80 bg-popover/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
      style={{ height: "min(60vh, 480px)" }}
    >
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">Conversation</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          onClick={() => setChatSheetOpen(false)}
          aria-label="Close conversation"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="flex flex-col items-start gap-2 px-4 py-6">
          <p className="text-sm text-foreground/80">No messages yet</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Type below to start a conversation with the assistant. The history
            will live here and persist per project.
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
