"use client";

import { type ReactNode } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NodeSchema } from "@/types/node";

import { DotHandle } from "./handle-dot";

export interface BaseNodeProps {
  nodeId: string;
  schema: NodeSchema;
  selected: boolean;
  children: ReactNode;
  onDelete?: () => void;
}

/**
 * BaseNode — shared shell for every node component on the canvas.
 *
 * Renders the card chrome (header with icon + title, body slot, footer with
 * input/output handles arranged on the sides). Individual nodes own their
 * body content; the BaseNode is purely chrome.
 *
 * Handles are positioned absolutely on the card sides (left = inputs,
 * right = outputs), one row per handle. The vertical placement reads from
 * the schema order, so reordering inputs in the schema reorders them
 * visually.
 */
export function BaseNode({
  schema,
  selected,
  children,
  onDelete,
}: BaseNodeProps) {
  const Icon = schema.icon;

  return (
    <div
      className={cn(
        "group relative min-w-[220px] rounded-xl border bg-card/95 backdrop-blur-sm shadow-md shadow-black/40 transition-colors",
        selected
          ? "border-accent/80 ring-1 ring-accent/40"
          : "border-border/80 hover:border-border",
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground/90">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{schema.title}</span>
        </div>

        {onDelete && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100"
                aria-label="Delete node"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Delete</TooltipContent>
          </Tooltip>
        )}
      </header>

      {/* Body — node-specific content (textarea, picker, preview, …) */}
      <div className="px-3 py-2">{children}</div>

      {/* Handle rails on each side. Inputs left, outputs right. */}
      <div className="pointer-events-none absolute -left-1 top-0 flex h-full flex-col items-start justify-center gap-1 py-2">
        {schema.inputs.map((io) => (
          <div key={io.id} className="pointer-events-auto -translate-x-1/2">
            <DotHandle
              id={io.id}
              side="left"
              dataType={io.dataType}
            />
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute -right-1 top-0 flex h-full flex-col items-end justify-center gap-1 py-2">
        {schema.outputs.map((io) => (
          <div key={io.id} className="pointer-events-auto translate-x-1/2">
            <DotHandle
              id={io.id}
              side="right"
              dataType={io.dataType}
            />
          </div>
        ))}
      </div>

      {/* Footer band — handle labels live here so they don't fight the body */}
      {(schema.inputs.length > 0 || schema.outputs.length > 0) && (
        <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          <span>
            {schema.inputs.map((io) => io.label).join(" · ") || ""}
          </span>
          <span>
            {schema.outputs.map((io) => io.label).join(" · ") || ""}
          </span>
        </footer>
      )}
    </div>
  );
}
