"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * IteratorCursor — the `<button>‹</button> N / M <button>›</button>` cluster
 * shared between Image Iterator and Text Iterator (Slice 5.5b, ADR-0031).
 *
 * Pure presentational + click-handler. Doesn't read or write any store —
 * the parent owns the cursor state and reacts to `onCursorChange`.
 *
 * Behaviour:
 *  - Shows the **1-indexed** cursor in the chip ("1 / 4" instead of "0 / 4")
 *    because that's how every-day humans count. The internal cursor stays
 *    0-indexed; the chip is the only place we offset for display.
 *  - Arrows clamp at `[0, count - 1]`. Clicking the right arrow on the
 *    last item is a no-op; clicking the left arrow on the first item is
 *    a no-op. The non-actionable arrow goes to a muted color + cursor
 *    `not-allowed` so users feel the boundary.
 *  - When `count <= 1`, both arrows render disabled and the chip just
 *    says "1 / 1" or "0 / 0" so the layout doesn't shift between the
 *    empty and populated states.
 *
 * Note on event propagation: the buttons stop pointer-down so a click
 * on an arrow doesn't bubble up to React Flow's selection / pan handlers
 * (matches the BaseNode drag-protocol from ADR-0031, Slice 5.4 — the
 * arrows live inside the body which already has `nodrag`, but
 * stopPropagation is belt + suspenders).
 */
export interface IteratorCursorProps {
  /** Total number of items. */
  count: number;
  /** Current cursor (0-indexed). */
  cursor: number;
  /** Called with the new cursor when the user navigates. */
  onCursorChange: (next: number) => void;
  /** Optional className on the wrapper for parent layout control. */
  className?: string;
  /** Optional aria-label prefix to disambiguate when multiple cursors are on screen. */
  ariaLabelPrefix?: string;
  /**
   * Lock both arrows (the counter still shows the position). Used when an
   * external Number node drives the cursor — the user edits the Number, not
   * the arrows, so we grey them out to signal "driven from elsewhere".
   */
  readOnly?: boolean;
}

export function IteratorCursor({
  count,
  cursor,
  onCursorChange,
  className,
  ariaLabelPrefix,
  readOnly = false,
}: IteratorCursorProps) {
  const safeCount = Math.max(0, Math.trunc(count));
  const safeCursor =
    safeCount === 0
      ? 0
      : Math.min(Math.max(0, Math.trunc(cursor)), safeCount - 1);

  const canGoBack = !readOnly && safeCount > 1 && safeCursor > 0;
  const canGoForward = !readOnly && safeCount > 1 && safeCursor < safeCount - 1;
  const labelPrefix = ariaLabelPrefix ? `${ariaLabelPrefix} ` : "";

  function step(delta: -1 | 1) {
    const next = safeCursor + delta;
    if (next < 0 || next >= safeCount) return;
    onCursorChange(next);
  }

  return (
    <div
      data-testid="iterator-cursor"
      className={cn(
        "flex select-none items-center gap-1 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10.5px] font-medium text-foreground/80",
        className,
      )}
    >
      <button
        type="button"
        aria-label={`${labelPrefix}previous item`}
        disabled={!canGoBack}
        onClick={() => step(-1)}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded transition-colors",
          canGoBack
            ? "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            : "cursor-not-allowed text-muted-foreground/30",
        )}
      >
        <ChevronLeft className="h-3 w-3" />
      </button>
      <span
        data-testid="iterator-cursor-counter"
        className="min-w-[2.25rem] text-center tabular-nums"
      >
        {safeCount === 0 ? "0 / 0" : `${safeCursor + 1} / ${safeCount}`}
      </span>
      <button
        type="button"
        aria-label={`${labelPrefix}next item`}
        disabled={!canGoForward}
        onClick={() => step(1)}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded transition-colors",
          canGoForward
            ? "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            : "cursor-not-allowed text-muted-foreground/30",
        )}
      >
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}
