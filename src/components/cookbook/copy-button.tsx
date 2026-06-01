"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  /** Tooltip label. Defaults to "Copy to clipboard". */
  label?: string;
  /** Optional className override. */
  className?: string;
  /** Smaller variant for inline use next to titles. */
  size?: "sm" | "default";
}

/**
 * Reusable Cookbook copy-to-clipboard button.
 *
 * Premium-UI principle "Copy-paste first-class": every prompt, every
 * recipe summary, every code-defined string in the Library has one of
 * these next to it. Plain-text payload only — no markdown, no fences —
 * so the copied content drops cleanly into ChatGPT / Claude / etc.
 *
 * Visual feedback: on success the icon swaps to a check for 1.5s; on
 * failure an inline label flips to "Copy failed" so the user knows to
 * try the manual selection path.
 */
export function CopyButton({
  text,
  label = "Copy to clipboard",
  className,
  size = "default",
}: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      console.warn("[cookbook] copy failed:", err);
      setState("error");
      window.setTimeout(() => setState("idle"), 2000);
    }
  }

  const tooltipText =
    state === "copied"
      ? "Copied"
      : state === "error"
        ? "Copy failed"
        : label;

  const Icon = state === "copied" ? Check : Copy;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void handleCopy()}
          aria-label={tooltipText}
          data-testid="cookbook-copy-button"
          className={cn(
            size === "sm" ? "h-6 w-6" : "h-7 w-7",
            "rounded-md text-muted-foreground hover:text-foreground",
            state === "copied" && "text-emerald-500 hover:text-emerald-500",
            state === "error" && "text-destructive hover:text-destructive",
            className,
          )}
        >
          <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
