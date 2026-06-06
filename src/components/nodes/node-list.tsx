"use client";

import { ListOrdered } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { useExecutionStore } from "@/lib/stores/execution-store";
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
 * Output `dataType: "text"` because in M0a the dominant flow is
 * `text-array → list → llm-text.user`, so the handle reads as text-blue
 * and visually pairs with the LLM's text input. The engine has no
 * edge-time type check (only runtime `extractInputByType`), so an
 * upstream image array still flows through if connected — degrades
 * gracefully. Switch to `dataType: "any"` if/when image-array → list
 * becomes a primary use case.
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
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<ListNodeConfig>) {
  const modeId = useId();
  const pickerId = useId();
  const mode = config.mode ?? "fixed";
  const cursor = config.cursor ?? 0;

  // Slice 6.3 — live preview. List subscribes to its upstream record
  // (the node connected to `items`) and shows a dropdown of every
  // available item. Selecting one writes `config.cursor` so the next
  // emit yields that item.
  const upstream = useUpstreamItemsForList(nodeId);
  const items = upstream.items;

  // When a Number node is wired into `cursor`, IT drives selection
  // (execute() honors it over config.cursor). Reflect that live in the
  // body so changing the Number updates which item shows as selected —
  // index 0 = first item. The picker becomes read-only (externally
  // driven) so the user edits the Number, not the dropdown.
  const externalCursor = useExternalCursorForList(nodeId);
  const isExternallyDriven = externalCursor !== null;
  const effectiveCursor =
    isExternallyDriven && items.length > 0
      ? clampCursor(externalCursor, items.length)
      : cursor;

  function describeItem(item: StandardizedOutput, index: number): string {
    if (item.type === "text") {
      const v = String(item.value);
      return v.length > 60 ? `${v.slice(0, 57)}…` : v;
    }
    if (item.type === "image") return `Image ${index + 1}`;
    if (item.type === "video") return `Video ${index + 1}`;
    if (item.type === "number") return `Number ${item.value}`;
    if (item.type === "soul-id") return `Soul ID ${item.value.name ?? index + 1}`;
    return `Item ${index + 1}`;
  }

  const selected =
    items.length > 0
      ? items[Math.min(effectiveCursor, items.length - 1)]
      : undefined;

  return (
    <div className="flex w-full min-w-[240px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center justify-between gap-2">
        <IteratorCursor
          count={Math.max(items.length, 1)}
          cursor={Math.min(effectiveCursor, Math.max(items.length - 1, 0))}
          onCursorChange={(next) => updateConfig({ cursor: next })}
          ariaLabelPrefix="List"
        />
        <span
          data-testid="list-mode-chip"
          className="select-none rounded-md bg-foreground/[0.04] px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
        >
          {isExternallyDriven ? `index ${effectiveCursor}` : mode}
        </span>
      </div>

      {items.length > 0 ? (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={pickerId}
            className="text-[10.5px] uppercase tracking-wider text-muted-foreground"
          >
            {isExternallyDriven ? "Selected (driven by Number)" : "Pick"}
          </label>
          <select
            id={pickerId}
            data-testid="list-item-picker"
            value={Math.min(effectiveCursor, items.length - 1)}
            disabled={isExternallyDriven}
            onChange={(e) =>
              updateConfig({ cursor: Number(e.target.value) })
            }
            onPointerDown={(e) => e.stopPropagation()}
            className="h-7 rounded-md border border-border/60 bg-background/40 px-2 text-xs disabled:opacity-70"
          >
            {items.map((item, i) => (
              <option key={i} value={i}>
                {`${i}. ${describeItem(item, i)}`}
              </option>
            ))}
          </select>
          {selected ? <ListItemPreview item={selected} /> : null}
        </div>
      ) : null}

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

      {items.length === 0 ? (
        <p className="rounded-md bg-foreground/[0.04] px-2 py-1 text-[10.5px] text-muted-foreground">
          Wire an array into <code className="font-mono">items</code>; the list emits one item per run.
          Wire a Number into <code className="font-mono">cursor</code> to drive selection externally.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Visual preview of the currently selected item, so the List reads at a
 * glance which media it'll emit (not just a "Video 2" label). Renders the
 * appropriate player/thumbnail per type; scalar types fall back to text.
 */
function ListItemPreview({ item }: { item: StandardizedOutput }) {
  if (item.type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.value.url}
        alt="Selected"
        onPointerDown={(e) => e.stopPropagation()}
        className="mt-1 block w-full rounded-md bg-black"
      />
    );
  }
  if (item.type === "video") {
    return (
      <video
        key={item.value.url}
        src={item.value.url}
        controls
        loop
        playsInline
        preload="metadata"
        onPointerDown={(e) => e.stopPropagation()}
        className="mt-1 block w-full rounded-md bg-black"
        style={{ aspectRatio: "16 / 9" }}
      />
    );
  }
  if (item.type === "audio") {
    return (
      <audio
        key={item.value.url}
        src={item.value.url}
        controls
        preload="metadata"
        onPointerDown={(e) => e.stopPropagation()}
        className="mt-1 h-8 w-full"
      />
    );
  }
  if (item.type === "text") {
    return (
      <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md bg-foreground/[0.04] px-2 py-1 text-[11px] leading-snug text-foreground/80">
        {String(item.value)}
      </p>
    );
  }
  return null;
}

/**
 * Resolve the upstream items array for a given List node by walking the
 * workflow graph for the `items` edge and reading its source's record.
 */
function useUpstreamItemsForList(nodeId: string): {
  items: StandardizedOutput[];
} {
  const sourceNodeId = useWorkflowStore((s) => {
    const edge = s.edges.find(
      (e) => e.target === nodeId && e.targetHandle === "items",
    );
    return edge?.source ?? null;
  });
  const upstreamRecord = useExecutionStore((s) =>
    sourceNodeId ? s.records.get(sourceNodeId) : undefined,
  );
  const out = upstreamRecord?.output;
  if (!out) return { items: [] };
  return {
    items: Array.isArray(out) ? out : [out],
  };
}

/**
 * Resolve the external `cursor` value (from a wired Number node) for live
 * body preview. Returns the number the upstream node emits, or null when
 * nothing is wired into `cursor`. Reactive — re-renders when the Number's
 * output record changes, so editing the Number updates the List selection.
 */
function useExternalCursorForList(nodeId: string): number | null {
  const sourceNodeId = useWorkflowStore((s) => {
    const edge = s.edges.find(
      (e) => e.target === nodeId && e.targetHandle === "cursor",
    );
    return edge?.source ?? null;
  });
  const record = useExecutionStore((s) =>
    sourceNodeId ? s.records.get(sourceNodeId) : undefined,
  );
  if (!sourceNodeId) return null;
  const out = record?.output;
  const single = Array.isArray(out) ? out[0] : out;
  if (single && single.type === "number") return single.value;
  return null;
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
  outputs: [{ id: "out", label: "out", dataType: "text" }],
  configParams: {
    mode: { control: "select", options: LIST_MODES, label: "mode" },
    cursor: { control: "number", label: "cursor" },
  },
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
    resizable: "both",
  },
});
