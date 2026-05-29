"use client";

import { Check, CloudOff, Loader2 } from "lucide-react";

import { useSaveStatusStore } from "@/lib/stores/save-status-store";
import { cn } from "@/lib/utils";

/**
 * SaveIndicator — small "Saving… / Saved / Save failed" pill under the
 * project title. Driven by `save-status-store`, which the autosave layer
 * (wired in the ProjectSession) updates. Hidden while idle so it doesn't
 * add chrome before the first save.
 */
export function SaveIndicator() {
  const status = useSaveStatusStore((s) => s.status);
  if (status === "idle") return null;

  const content =
    status === "saving"
      ? { icon: <Loader2 className="h-3 w-3 animate-spin" />, label: "Saving…" }
      : status === "saved"
        ? { icon: <Check className="h-3 w-3" />, label: "Saved" }
        : { icon: <CloudOff className="h-3 w-3" />, label: "Save failed" };

  return (
    <span
      data-testid="save-indicator"
      className={cn(
        "pointer-events-none inline-flex items-center gap-1 rounded-full border border-border/50 bg-popover/70 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur-md",
        status === "error" && "border-destructive/40 text-destructive",
      )}
    >
      {content.icon}
      {content.label}
    </span>
  );
}
