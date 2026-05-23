"use client";

import { Type } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import {
  applySelectionMode,
  type SelectionMode,
  type SelectionRange,
} from "@/lib/iterators/selection-mode";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeBodyProps, StandardizedOutput } from "@/types/node";

/**
 * Text Iterator (Slice 5.5, ADR-0031) — N strings stored INSIDE the node
 * with the same selection-mode + cursor vocabulary as Image Iterator.
 *
 * Two natural sources of texts:
 *   - The user types / pastes a list directly (one per line).
 *   - An LLM Text node emits a delimiter-separated string that an
 *     `Array` node (Slice 5.6) splits and feeds in via the future
 *     `texts` input handle. Slice 5.5 ships only the static-array case;
 *     plumbing the input handle is a 5.6 follow-up alongside `Array`.
 *
 * Engine hookup: same as Image Iterator. `iterator: true` is set; the
 * fan-out branch fires whenever `execute()` returns a multi-item array
 * onto a single-input downstream handle (so a single LLM Text reading
 * `selectionMode: "all"` from a Text Iterator runs N times in parallel).
 */
export interface TextIteratorNodeConfig {
  /** The list of texts. Order matters. */
  texts: string[];
  /** Pointer into `texts` used by `fixed` / `increment` / `decrement` / `random`. */
  cursor: number;
  /** What slice of `texts` to emit on a run. See `selection-mode.ts`. */
  selectionMode: SelectionMode;
  /** Inclusive `[start, end]` slice for `selectionMode === "range"`. */
  range?: SelectionRange;
}

function TextIteratorNodeBody({
  nodeId,
  config,
}: NodeBodyProps<TextIteratorNodeConfig>) {
  const texts = config.texts ?? [];
  const safeCursor = clampCursor(config.cursor ?? 0, texts.length);
  const current = texts[safeCursor];
  const count = texts.length;
  const mode = config.selectionMode ?? "all";

  // Same Slice 5.5a placeholder as the Image Iterator: count + mode now,
  // cursor / mode picker UI lands in 5.5b.
  void nodeId;

  const previewText = current?.length ? truncate(current, 60) : null;

  return (
    <div className="flex w-full min-w-[220px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      <div
        data-testid="text-iterator-count"
        className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground"
      >
        <Type className="h-3 w-3 shrink-0 text-accent" />
        <span className="leading-snug">
          {count === 0 ? (
            <>
              <span className="text-foreground/80">No texts yet.</span>{" "}
              Editor lands in Slice 5.5b.
            </>
          ) : (
            <>
              <span className="text-foreground/85">
                {count} text{count === 1 ? "" : "s"}
              </span>{" "}
              · mode <span className="text-foreground/80">{mode}</span>
              {previewText ? (
                <>
                  {" "}
                  · current{" "}
                  <span className="text-foreground/70">
                    &ldquo;{previewText}&rdquo;
                  </span>
                </>
              ) : null}
            </>
          )}
        </span>
      </div>
      <p className="px-1 text-[10.5px] leading-snug text-muted-foreground/60">
        Cursor + mode picker UI lands in Slice 5.5b.
      </p>
    </div>
  );
}

export const textIteratorNodeSchema = defineNode<TextIteratorNodeConfig>({
  kind: "text-iterator",
  category: "iterator",
  title: "Text Iterator",
  description:
    "Holds N texts. Selection mode + cursor pick what gets emitted on a run.",
  icon: Type,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "text" }],
  defaultConfig: {
    texts: [],
    cursor: 0,
    selectionMode: "all",
  },
  reactive: true,
  iterator: true,
  execute: async ({ nodeId, config }) => {
    const texts = config.texts ?? [];
    const items = texts.map<StandardizedOutput>((value) => ({
      type: "text",
      value,
    }));

    const { items: emitted, nextCursor } = applySelectionMode({
      items,
      mode: config.selectionMode ?? "all",
      cursor: clampCursor(config.cursor ?? 0, items.length),
      range: config.range,
    });

    if (
      (config.selectionMode === "increment" ||
        config.selectionMode === "decrement" ||
        config.selectionMode === "random") &&
      nextCursor !== (config.cursor ?? 0) &&
      items.length > 0
    ) {
      const ws = useWorkflowStore.getState();
      ws.updateNodeConfig<TextIteratorNodeConfig>(nodeId, {
        cursor: nextCursor,
      });
    }

    return emitted;
  },
  Body: TextIteratorNodeBody,
  size: {
    defaultWidth: 240,
    minWidth: 220,
    maxWidth: 360,
    resizable: "horizontal",
  },
});

function clampCursor(cursor: number, count: number): number {
  if (count === 0) return 0;
  if (!Number.isFinite(cursor)) return 0;
  const truncated = Math.trunc(cursor);
  if (truncated < 0) return 0;
  if (truncated >= count) return count - 1;
  return truncated;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
