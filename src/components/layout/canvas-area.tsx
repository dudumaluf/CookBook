"use client";

import { Sparkles } from "lucide-react";

export function CanvasArea() {
  return (
    <main
      role="main"
      aria-label="Canvas"
      className="relative flex flex-1 items-center justify-center overflow-hidden bg-background"
    >
      {/* Dotted background pattern */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--color-muted-foreground) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative z-10 flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Sparkles className="h-4 w-4" />
        </div>
        <h1 className="text-base font-medium text-foreground">Empty canvas</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Day 1 shell only. Drag assets from the Library, ask the assistant
          below, or run a recipe to start.
        </p>
      </div>
    </main>
  );
}
