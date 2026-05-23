"use client";

import { Type } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import {
  SELECTION_MODES,
  applySelectionMode,
  type SelectionMode,
  type SelectionRange,
} from "@/lib/iterators/selection-mode";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeBodyProps, StandardizedOutput } from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";

/**
 * Text Iterator (Slice 5.5, ADR-0031) — N strings stored INSIDE the node
 * with the same selection-mode + cursor vocabulary as Image Iterator.
 *
 * Two natural sources of texts:
 *   - The user types / pastes a list directly (one per line). This is
 *     the Slice 5.5b body — a plain textarea that splits on newlines.
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
  config,
  updateConfig,
}: NodeBodyProps<TextIteratorNodeConfig>) {
  const texts = config.texts ?? [];
  const count = texts.length;
  const safeCursor = clampCursor(config.cursor ?? 0, count);
  const current = texts[safeCursor];

  // The body has two states: an empty editor (textarea) when nothing's
  // entered yet, or a preview-of-current + cursor + mode chip once
  // populated. Both branches let the user edit the bag inline by
  // toggling to the "edit" surface (the textarea below). For 5.5b we
  // ship just one surface — a textarea always visible when count is 0,
  // and a compact preview + cursor when populated; the user edits via
  // the settings popover (`⋯`).
  return (
    <div className="flex w-full min-w-[220px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      {count === 0 ? (
        <TextEditor
          value=""
          onCommit={(next) =>
            updateConfig({ texts: linesToTexts(next), cursor: 0 })
          }
        />
      ) : (
        <>
          <div
            data-testid="text-iterator-preview"
            className="rounded-md bg-foreground/[0.04] px-2 py-1.5 text-[11px] leading-relaxed text-foreground/85"
          >
            {current && current.length > 0 ? (
              <span className="line-clamp-3 whitespace-pre-wrap break-words">
                {current}
              </span>
            ) : (
              <span className="italic text-muted-foreground/70">
                (empty entry)
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <IteratorCursor
              count={count}
              cursor={safeCursor}
              ariaLabelPrefix="Text"
              onCursorChange={(next) => updateConfig({ cursor: next })}
            />
            <span
              data-testid="text-iterator-mode-chip"
              className="select-none rounded-md bg-foreground/[0.04] px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
            >
              {config.selectionMode ?? "all"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function TextEditor({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  // The textarea is "commit on blur" — typing while editing doesn't
  // round-trip through the workflow store on every keystroke (which
  // would resplit + re-render the body). On blur we split + commit.
  return (
    <textarea
      defaultValue={value}
      onBlur={(e) => onCommit(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onWheelCapture={(e) => e.stopPropagation()}
      placeholder={"One text per line.\nEach line becomes one item."}
      aria-label="Iterator texts (one per line)"
      className="min-h-[6rem] w-full resize-y rounded-md bg-foreground/[0.04] px-2 py-1.5 text-[11.5px] leading-relaxed text-foreground/90 outline-none placeholder:text-muted-foreground/60 focus:bg-foreground/[0.06]"
    />
  );
}

function linesToTexts(raw: string): string[] {
  // Split on any newline (handles \r\n + \n + \r), drop empty lines so
  // a trailing newline doesn't produce a phantom empty entry.
  return raw
    .split(/\r\n|\r|\n/)
    .map((s) => s.trimEnd())
    .filter((s) => s.length > 0);
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings popover content                                               */
/* ────────────────────────────────────────────────────────────────────── */

function TextIteratorSettingsContent({
  config,
  updateConfig,
}: NodeBodyProps<TextIteratorNodeConfig>) {
  const modeId = useId();
  const editId = useId();
  const startId = useId();
  const endId = useId();

  const texts = config.texts ?? [];
  const count = texts.length;
  const mode = config.selectionMode ?? "all";
  const range = config.range;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={modeId} className="font-medium text-foreground/90">
          Selection mode
        </label>
        <select
          id={modeId}
          value={mode}
          onChange={(e) =>
            updateConfig({ selectionMode: e.target.value as SelectionMode })
          }
          className="h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {SELECTION_MODES.map((m) => (
            <option key={m} value={m}>
              {SELECTION_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        <p className="text-[10.5px] leading-snug text-muted-foreground/80">
          {SELECTION_MODE_DESCRIPTIONS[mode]}
        </p>
      </div>

      {mode === "range" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={startId} className="text-[10.5px] text-muted-foreground">
              Start (1-indexed)
            </label>
            <input
              id={startId}
              type="number"
              min={1}
              max={Math.max(count, 1)}
              value={(range?.start ?? 0) + 1}
              onChange={(e) => {
                const oneIndexed = Number(e.target.value);
                const start = Math.max(0, Math.trunc(oneIndexed) - 1);
                updateConfig({
                  range: {
                    start,
                    end: range?.end ?? Math.max(start, count - 1),
                  },
                });
              }}
              className="h-7 rounded-md border border-border/60 bg-background/40 px-2 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={endId} className="text-[10.5px] text-muted-foreground">
              End (1-indexed)
            </label>
            <input
              id={endId}
              type="number"
              min={1}
              max={Math.max(count, 1)}
              value={(range?.end ?? Math.max(count - 1, 0)) + 1}
              onChange={(e) => {
                const oneIndexed = Number(e.target.value);
                const end = Math.max(0, Math.trunc(oneIndexed) - 1);
                updateConfig({
                  range: {
                    start: range?.start ?? 0,
                    end,
                  },
                });
              }}
              className="h-7 rounded-md border border-border/60 bg-background/40 px-2 text-xs"
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={editId} className="font-medium text-foreground/90">
          Texts (one per line)
        </label>
        <textarea
          id={editId}
          defaultValue={texts.join("\n")}
          onBlur={(e) =>
            updateConfig({
              texts: e.target.value
                .split(/\r\n|\r|\n/)
                .map((s) => s.trimEnd())
                .filter((s) => s.length > 0),
              cursor: 0,
            })
          }
          rows={5}
          placeholder="alpha&#10;beta&#10;gamma"
          className="w-full resize-y rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-[11.5px] leading-relaxed text-foreground/90 outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      <div className="rounded-md bg-foreground/[0.04] px-2 py-1.5 text-[10.5px] text-muted-foreground">
        {count === 0
          ? "No texts yet."
          : `${count} text${count === 1 ? "" : "s"} available.`}
      </div>
    </div>
  );
}

const SELECTION_MODE_LABELS: Record<SelectionMode, string> = {
  fixed: "Fixed (cursor only)",
  increment: "Increment (advance +1 each run)",
  decrement: "Decrement (advance −1 each run)",
  random: "Random",
  range: "Range",
  all: "All (fan-out everything)",
};

const SELECTION_MODE_DESCRIPTIONS: Record<SelectionMode, string> = {
  fixed: "Always emit the cursor item.",
  increment: "Emit the cursor item, then move the cursor forward (wraps).",
  decrement: "Emit the cursor item, then move the cursor backward (wraps).",
  random: "Pick one item at random each run; updates the cursor.",
  range: "Emit a slice of the bag; cursor unchanged.",
  all: "Emit every item; downstream fan-outs.",
};

function hasIteratorOverrides(config: TextIteratorNodeConfig): boolean {
  return (
    (config.selectionMode ?? "all") !== "all" || (config.cursor ?? 0) !== 0
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
  settings: {
    Content: TextIteratorSettingsContent,
    hasOverrides: hasIteratorOverrides,
  },
  size: {
    defaultWidth: 260,
    minWidth: 240,
    maxWidth: 400,
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
