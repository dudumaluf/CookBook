"use client";

import { ArrowUp, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export function PromptBar() {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on "/" key (when not already typing in another input)
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
      className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-6"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // wired up in M0a
        }}
        className="pointer-events-auto flex w-full max-w-[640px] items-end gap-2 rounded-2xl border border-border/80 bg-popover/95 p-2 shadow-lg shadow-black/30 backdrop-blur-xl"
      >
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
              // wired up in M0a
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
      </form>
    </div>
  );
}
