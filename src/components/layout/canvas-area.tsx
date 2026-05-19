"use client";

import { ArrowDown, Image as ImageIcon, Wand2, Film, Plus } from "lucide-react";
import { type ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { CanvasContextMenu } from "./canvas-context-menu";

/**
 * CanvasArea
 *
 * Renders the dotted background + welcome state. Once nodes exist (M0a), the
 * welcome will swap for the React Flow canvas.
 *
 * Wrapped in `CanvasContextMenu` so right-clicking anywhere on the canvas
 * (background or future nodes) opens the canvas action menu.
 */
export function CanvasArea() {
  return (
    <CanvasContextMenu>
      <main
        role="main"
        aria-label="Canvas"
        className="relative flex flex-1 overflow-hidden bg-background"
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--color-muted-foreground) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <WelcomeState />
      </main>
    </CanvasContextMenu>
  );
}

function WelcomeState() {
  const libraryOpen = useLayoutStore((s) => s.libraryOpen);
  const queueOpen = useLayoutStore((s) => s.queueOpen);
  // Reserve breathing space for floating panels so the centered welcome
  // content stays visible between them rather than disappearing behind.
  const padLeft = libraryOpen ? "calc(280px + 2rem)" : "1.5rem";
  const padRight = queueOpen ? "calc(320px + 2rem)" : "1.5rem";

  return (
    <div
      className="@container/welcome relative z-10 flex w-full items-start justify-center overflow-y-auto pb-32 pt-16 transition-[padding] duration-200"
      style={{ paddingLeft: padLeft, paddingRight: padRight }}
    >
      <div className="flex w-full max-w-[720px] flex-col items-center gap-8 @md/welcome:gap-10">
        <header className="flex flex-col items-center gap-3 text-center">
          <span className="rounded-full border border-border/80 bg-card px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Cookbook · Day 1 shell
          </span>
          <h1 className="text-balance text-xl font-medium tracking-tight text-foreground @md/welcome:text-2xl @2xl/welcome:text-3xl">
            What do you want to make?
          </h1>
          <p className="max-w-md text-balance text-sm leading-relaxed text-muted-foreground">
            Start from a recipe below, or describe what you want in the prompt
            bar. Recipes land in M0a — the shell is ready for them.
          </p>
        </header>

        <div className="grid w-full grid-cols-1 gap-3 @xl/welcome:grid-cols-3">
          <RecipeCard
            icon={ImageIcon}
            title="Soul Image Burst"
            description="N variations of you in chosen settings"
            badge="M0a"
          />
          <RecipeCard
            icon={Wand2}
            title="Reference Edit"
            description="Tweak any image with a reference + prompt"
            badge="M0b"
          />
          <RecipeCard
            icon={Film}
            title="Photo → Video"
            description="Turn a still into a short clip"
            badge="M0c"
          />
        </div>

        <div className="flex flex-col items-center gap-3">
          <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled>
            <Plus className="h-3.5 w-3.5" />
            Blank canvas
          </Button>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Or talk to the assistant below
            <ArrowDown className="h-3 w-3" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  );
}

function RecipeCard({
  icon: Icon,
  title,
  description,
  badge,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <div
      className="group relative flex flex-col gap-3 rounded-xl border border-border/80 bg-card/50 p-4 opacity-70"
      aria-disabled
    >
      <div className="flex items-center justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon className="h-4 w-4" />
        </div>
        <span className="rounded-full border border-border/80 bg-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {badge}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
