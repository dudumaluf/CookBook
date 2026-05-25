"use client";

import { ListOrdered } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type {
  NodeBodyProps,
  StandardizedOutput,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";

/**
 * List node (Slice 5.7).
 *
 * Picks ONE item out of an upstream array. Unlike the Image / Text
 * Iterator nodes (which fan out — one execute per item), List emits a
 * single output, so downstream graphs stay scalar. The selection mode
 * vocab is a subset of the iterators' (`fixed | increment | decrement
 * | random`) — `range` and `all` don't apply because List doesn't
 * fan out.
 *
 * Two cursor sources, in priority order:
 * 1. **External `cursor` input** (number datatype). When wired, the
 *    upstream number wins — useful for chaining a Number node with
 *    `mode: increment` to drive the List per run, ComfyUI-style.
 *    The list's own mode is ignored when an external cursor is
 *    present (the upstream number already has its own mutation
 *    discipline).
 * 2. **Internal `cursor` config**, optionally mutated each run per
 *    `mode` (mirroring the iterator family).
 *
 * Output `dataType: "any"` because the list is type-opaque — whatever
 * the upstream produced is what we re-emit. The cache key still
 * works because `StandardizedOutput`'s `type` field round-trips
 * through `extractInputByType`'s expected check downstream.
 */

export type ListNodeMode =
  | "fixed"
  | "increment"
  | "decrement"
  | "random";

export interface ListNodeConfig {
  cursor: number;
  mode: ListNodeMode;
}

const LIST_MODES: ListNodeMode[] = [
  "fixed",
  "increment",
  "decrement",
  "random",
];

const LIST_MODE_LABELS: Record<ListNodeMode, string> = {
  fixed: "Fixed (cursor only)",
  increment: "Increment +1 each run",
  decrement: "Decrement −1 each run",
  random: "Random",
};

function clampCursor(cursor: number, count: number): number {
  if (count <= 0) return 0;
  const safe = Number.isFinite(cursor) ? Math.trunc(cursor) : 0;
  // Wrap into [0, count).
  return ((safe % count) + count) % count;
}

function ListNodeBody({
  config,
  updateConfig,
}: NodeBodyProps<ListNodeConfig>) {
  const modeId = useId();
  const mode = config.mode ?? "fixed";
  const cursor = config.cursor ?? 0;

  return (
    <div className="flex w-full min-w-[220px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center justify-between gap-2">
        {/* Cursor count is unknown at render time (depends on upstream).
            Render the navigation control with count=1 placeholder until
            an actual run resolves the array — body is purely a setting
            surface. */}
        <IteratorCursor
          count={Math.max(cursor + 1, 1)}
          cursor={cursor}
          onCursorChange={(next) => updateConfig({ cursor: next })}
          ariaLabelPrefix="List"
        />
        <span
          data-testid="list-mode-chip"
          className="select-none rounded-md bg-foreground/[0.04] px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
        >
          {mode}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <label
          htmlFor={modeId}
          className="text-[10.5px] uppercase tracking-wider text-muted-foreground"
        >
          Mode
        </label>
        <select
          id={modeId}
          value={mode}
          onChange={(e) =>
            updateConfig({ mode: e.target.value as ListNodeMode })
          }
          onPointerDown={(e) => e.stopPropagation()}
          className="h-7 flex-1 rounded-md border border-border/60 bg-background/40 px-2 text-xs"
        >
          {LIST_MODES.map((m) => (
            <option key={m} value={m}>
              {LIST_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </div>

      <p className="rounded-md bg-foreground/[0.04] px-2 py-1 text-[10.5px] text-muted-foreground">
        Wire an array into <code className="font-mono">items</code>; the list emits one item per run.
        Wire a Number into <code className="font-mono">cursor</code> to drive selection externally.
      </p>
    </div>
  );
}

export const listNodeSchema = defineNode<ListNodeConfig>({
  kind: "list",
  category: "transform",
  title: "List",
  description:
    "Pick one item from an upstream array, with optional external cursor input.",
  icon: ListOrdered,
  inputs: [
    { id: "items", label: "items", dataType: "any", multiple: true },
    { id: "cursor", label: "cursor", dataType: "number" },
  ],
  outputs: [{ id: "out", label: "out", dataType: "any" }],
  defaultConfig: {
    cursor: 0,
    mode: "fixed",
  },
  reactive: true,
  execute: async ({ nodeId, config, inputs }) => {
    // Resolve the upstream array. We stay in the StandardizedOutput
    // shape (not unwrapped via extractInputArrayByType) so downstream
    // gets the full `{ type, value }` discriminator preserved.
    const raw = inputs.items;
    const list: StandardizedOutput[] = raw === undefined
      ? []
      : Array.isArray(raw)
        ? (raw as StandardizedOutput[])
        : [raw as StandardizedOutput];

    if (list.length === 0) {
      // No items — return an empty pass-through. Downstream nodes
      // consuming this will see no input and either bail or fall back
      // to their config.
      return [];
    }

    // External cursor input wins over internal cursor + mode (the
    // upstream Number node has its own mutation discipline; respecting
    // it keeps the chained graph predictable).
    const externalCursor = extractInputByType(inputs, "cursor", "number");
    if (externalCursor !== undefined) {
      const idx = clampCursor(externalCursor, list.length);
      return list[idx]!;
    }

    const mode: ListNodeMode = config.mode ?? "fixed";
    const cursor = clampCursor(config.cursor ?? 0, list.length);

    let pickedIndex = cursor;
    let nextCursor = cursor;

    if (mode === "fixed") {
      pickedIndex = cursor;
      nextCursor = cursor;
    } else if (mode === "increment") {
      pickedIndex = cursor;
      nextCursor = clampCursor(cursor + 1, list.length);
    } else if (mode === "decrement") {
      pickedIndex = cursor;
      nextCursor = clampCursor(cursor - 1, list.length);
    } else if (mode === "random") {
      pickedIndex = Math.floor(Math.random() * list.length);
      nextCursor = pickedIndex;
    }

    if (nextCursor !== (config.cursor ?? 0)) {
      const ws = useWorkflowStore.getState();
      ws.updateNodeConfig<ListNodeConfig>(nodeId, { cursor: nextCursor });
    }

    return list[pickedIndex]!;
  },
  Body: ListNodeBody,
  size: {
    defaultWidth: 240,
    minWidth: 220,
    maxWidth: 360,
    resizable: "horizontal",
  },
});
