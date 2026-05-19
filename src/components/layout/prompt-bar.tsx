"use client";

import { ArrowUp, Sparkles, ChevronUp, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatSheet } from "./chat-sheet";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * PromptBar
 *
 * Always-visible primary input. When the user toggles the chat history (chevron
 * or Cmd+J), the ChatSheet appears above it, making the prompt bar feel like
 * the sheet's footer.
 *
 * Day 1: form submit is a no-op (wired in M0a). "/" focuses the textarea.
 */
export function PromptBar() {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { chatSheetOpen, toggleChatSheet } = useLayoutStore();

  // Global "/" focuses the prompt bar unless the user is already typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      role="search"
      aria-label="Assistant prompt"
      className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex flex-col items-center gap-2 px-6"
    >
      {chatSheetOpen && <ChatSheet />}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          // wired in M0a
        }}
        className="pointer-events-auto flex w-full max-w-[640px] flex-col rounded-2xl border border-border/80 bg-popover/95 shadow-lg shadow-black/30 backdrop-blur-xl"
      >
        {/* Chevron handle to toggle chat history */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleChatSheet}
              aria-label={chatSheetOpen ? "Hide conversation" : "Show conversation"}
              aria-pressed={chatSheetOpen}
              className="mx-auto -mt-0 flex h-3 w-12 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:text-muted-foreground"
            >
              {chatSheetOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronUp className="h-3 w-3" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {chatSheetOpen ? "Hide conversation (\u2318 J)" : "Show conversation (\u2318 J)"}
          </TooltipContent>
        </Tooltip>

        <div className="flex items-end gap-2 px-2 pb-2 pt-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground">
            <Sparkles className="h-4 w-4" />
          </div>

          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={1}
            placeholder="Ask anything, or describe a recipe to build... (press / to focus)"
            aria-label="Prompt bar"
            className="min-h-9 max-h-32 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                // wired in M0a
              }
            }}
          />

          <Button
            type="submit"
            size="icon"
            disabled={!value.trim()}
            className="h-9 w-9 shrink-0 rounded-xl bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
