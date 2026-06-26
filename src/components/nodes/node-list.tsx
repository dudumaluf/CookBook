"use client";

import { ListOrdered } from "lucide-react";
import { useEffect, useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import { extractInputByType } from "@/lib/engine/extract-input";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type {
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
} from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";
import { MediaPreviewVideo } from "./media-preview";
import { PreviewImage } from "./preview-image";
import { useExternalIndex } from "./use-external-index";

/**
 * List node (Slice 5.7 / Slice 6.5).
 *
 * Picks ONE item out of an upstream array. Unlike the Image / Text
 * Iterator nodes (which fan out — one execute per item), List emits a
 * single output, so downstream graphs stay scalar. The selection mode
 * vocab is a subset of the iterators' (`fixed | increment | decrement
 * | random`) — `range` and `all` don't apply because List doesn't
 * fan out.
 *
 * ## Two ways to feed it (Slice 6.5)
 *
 * 1. **`items` array port** (top, multi-edge). Wire one or more nodes
 *    that emit arrays (Text Iterator, Image Iterator, Array, fan-out
 *    outputs of generators marked `multiple: true`). All array entries
 *    are flattened in edge order.
 * 2. **`slot-N` smart inputs** (auto-growing, mid). Wire individual
 *    items — a single Text node, a single Fal Image, etc. — directly
 *    into a slot. Each wired slot contributes ONE item to the picker.
 *    The pattern mirrors Text Concat / Image Concat / LLM Text smart
 *    inputs: an empty trailing slot is always visible, so plugging in
 *    grows another empty slot, capped at 8.
 *
 * The dropdown shows the union, in this order: array entries first
 * (in their natural order), then slot entries by port index. The
 * cursor / mode logic indexes across the WHOLE union — pick one of N
 * mixed sources without authoring an Array node first.
 *
 * Two cursor sources, in priority order:
 * 1. **External index input** (number datatype). When wired, the
 *    upstream number wins — useful for chaining a Number node with
 *    `mode: increment` to drive the List per run, ComfyUI-style, or
 *    one Number driving several Lists in lockstep (aligned chunk
 *    selection across audio / video / image arrays). The list's own
 *    mode is ignored when an external index is present (the upstream
 *    number already has its own mutation discipline).
 * 2. **Internal `cursor` config**, optionally mutated each run per
 *    `mode` (mirroring the iterator family).
 *
 * Naming note: the input handle id + config key are both `cursor`
 * (stable since Slice 5.7 — existing edges, recipes, and saved projects
 * connect to it). The user-facing LABEL reads "index" everywhere — the
 * clearer word — without a breaking rename. See ADR-0077.
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
  /**
   * Number of `slot-N` smart-input ports rendered. Auto-grows in the body
   * to `maxWiredSlot + 2` (capped at MAX_SLOTS) so there's always one
   * empty trailing slot. Persisted on the node so re-mounts keep the
   * port shape stable across reloads (mirrors text-concat / image-concat).
   * Defaults to MIN_SLOTS = 1 — a single empty slot, invisible to
   * graphs that only use the `items` array port.
   */
  slotCount?: number;
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

/** Smart-input slot ports — see header comment "Two ways to feed it". */
const SLOT_PREFIX = "slot-";
const MIN_SLOTS = 1;
/** Cap mirrors Text Concat / Image Concat — 8 individual slots is plenty
 * before the user is better served by piping an Array node into `items`. */
const MAX_SLOTS = 8;

function listInputs(slotCount: number | undefined): NodeIO[] {
  const n = Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, slotCount ?? MIN_SLOTS));
  const slots: NodeIO[] = Array.from({ length: n }, (_, i) => ({
    id: `${SLOT_PREFIX}${i}`,
    label: `item ${i + 1}`,
    dataType: "any" as const,
  }));
  // Order matters — handles render top-to-bottom in array order on the
  // left edge of the node. The user expects:
  //   items   ← array fan-in (legacy / power use)
  //   item 1  ← smart inputs grow from here
  //   item N
  //   index   ← modifier last, visually separated
  // The handle id stays `cursor` (so existing edges / recipes / saved
  // projects keep connecting); only the user-facing LABEL reads "index".
  return [
    { id: "items", label: "items", dataType: "any", multiple: true },
    ...slots,
    { id: "cursor", label: "index", dataType: "number" },
  ];
}

function slotIndex(handle: string | undefined): number {
  if (!handle?.startsWith(SLOT_PREFIX)) return -1;
  const idx = Number(handle.slice(SLOT_PREFIX.length));
  return Number.isFinite(idx) ? idx : -1;
}

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

  // Auto-grow `slotCount` so there's always one empty trailing slot,
  // capped at MAX_SLOTS. Track maxConnectedSlot as a STABLE primitive
  // (a number, not a fresh object — returning an object loops React #185).
  const maxConnectedSlot = useWorkflowStore((s) => {
    let m = -1;
    for (const e of s.edges) {
      if (e.target !== nodeId) continue;
      m = Math.max(m, slotIndex(e.targetHandle));
    }
    return m;
  });
  const desiredSlotCount = Math.min(
    MAX_SLOTS,
    Math.max(MIN_SLOTS, maxConnectedSlot + 2),
  );
  const currentSlotCount = Math.min(
    MAX_SLOTS,
    Math.max(MIN_SLOTS, config.slotCount ?? MIN_SLOTS),
  );
  useEffect(() => {
    if (currentSlotCount !== desiredSlotCount) {
      updateConfig({ slotCount: desiredSlotCount });
    }
  }, [currentSlotCount, desiredSlotCount, updateConfig]);

  // Slice 6.3 — live preview. List subscribes to its upstream record
  // (the node connected to `items`) and shows a dropdown of every
  // available item. Selecting one writes `config.cursor` so the next
  // emit yields that item.
  //
  // Slice 6.5 extends this: the picker shows the UNION of the array
  // input + every wired slot (one item per slot), in `[items, slots…]`
  // order. The cursor / mode logic indexes the whole union.
  const arrayItems = useUpstreamArrayItems(nodeId);
  const slotItems = useUpstreamSlotItems(nodeId, currentSlotCount);
  const items: StandardizedOutput[] = [...arrayItems, ...slotItems];

  // When a Number node is wired into `cursor`, IT drives selection
  // (execute() honors it over config.cursor). Reflect that live in the
  // body so changing the Number updates which item shows as selected —
  // index 0 = first item. The picker becomes read-only (externally
  // driven) so the user edits the Number, not the dropdown.
  const externalCursor = useExternalIndex(nodeId, "cursor");
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
    if (item.type === "audio") return `Audio ${index + 1}`;
    if (item.type === "number") return `Number ${item.value}`;
    if (item.type === "soul-id") return `Soul ID ${item.value.name ?? index + 1}`;
    return `Item ${index + 1}`;
  }

  const selected =
    items.length > 0
      ? items[Math.min(effectiveCursor, items.length - 1)]
      : undefined;

  const wiredSlotCount = Math.max(0, maxConnectedSlot + 1);

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
          Wire an array into <code className="font-mono">items</code> or
          plug individual items into the <code className="font-mono">item N</code>{" "}
          slots — the list emits one per run. Wire a{" "}
          <code className="font-mono">Number</code> into{" "}
          <code className="font-mono">index</code> to drive selection externally.
        </p>
      ) : (
        // Tiny fingerprint so the user can see at a glance where each
        // item came from when they're mixing array + slots. Hidden when
        // only one source is in play to stay quiet.
        wiredSlotCount > 0 && arrayItems.length > 0 ? (
          <p className="text-[10px] text-muted-foreground/70">
            {arrayItems.length} from <code className="font-mono">items</code>{" "}
            · {slotItems.length} from{" "}
            <code className="font-mono">slot{slotItems.length === 1 ? "" : "s"}</code>
          </p>
        ) : null
      )}
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
    // Click → full-screen modal + download menu (PreviewImage).
    return <PreviewImage url={item.value.url} alt="Selected" className="mt-1 bg-black" />;
  }
  if (item.type === "video") {
    // Native controls give fullscreen ("view bigger") + the W×H chip.
    return (
      <MediaPreviewVideo
        key={item.value.url}
        url={item.value.url}
        controls
        loop
        className="mt-1"
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
 * Resolve the upstream ARRAY items wired into the legacy `items` port.
 * Walks the workflow graph for the `items` edge and reads its source's
 * record. Single-source upstream (no array) is normalized to a 1-item
 * array so it composes naturally with slot items downstream.
 */
function useUpstreamArrayItems(nodeId: string): StandardizedOutput[] {
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
  if (!out) return [];
  return Array.isArray(out) ? out : [out];
}

/**
 * Resolve the items wired into each `slot-N` port (Slice 6.5).
 *
 * Returns ONE StandardizedOutput per wired slot, in slot-index order.
 * If a slot's upstream emits an array, only the FIRST item is used —
 * the slot port is the "single item" affordance; an upstream that
 * really wants to fan out should be wired into the `items` port instead.
 *
 * Stability note: this hook subscribes to (a) the source-id-per-slot
 * derived as a stable comma-joined string from `s.edges`, and (b) the
 * `records` Map identity. Zustand v5 hands us a new Map reference per
 * mutation, so the body re-derives slot items only when execution data
 * actually changes (cheap — bounded by MAX_SLOTS = 8 lookups).
 */
function useUpstreamSlotItems(
  nodeId: string,
  slotCount: number,
): StandardizedOutput[] {
  const slotSourceIdsKey = useWorkflowStore((s) => {
    const ids: string[] = Array.from({ length: slotCount }, () => "");
    for (const e of s.edges) {
      if (e.target !== nodeId) continue;
      const idx = slotIndex(e.targetHandle);
      if (idx >= 0 && idx < slotCount) ids[idx] = e.source ?? "";
    }
    return ids.join("|");
  });
  const records = useExecutionStore((s) => s.records);

  const sourceIds = slotSourceIdsKey ? slotSourceIdsKey.split("|") : [];
  const items: StandardizedOutput[] = [];
  for (const id of sourceIds) {
    if (!id) continue;
    const out = records.get(id)?.output;
    if (!out) continue;
    const single = Array.isArray(out) ? out[0] : out;
    if (single) items.push(single);
  }
  return items;
}

export const listNodeSchema = defineNode<ListNodeConfig>({
  kind: "list",
  category: "transform",
  title: "List",
  description:
    "Pick one item from upstream sources. Wire an array into `items`, OR plug individual items (image / text / video / audio…) into the auto-growing `item N` slots — the dropdown shows them all together. Optional Number into `index` for external selection (one Number can drive several Lists in lockstep).",
  icon: ListOrdered,
  inputs: listInputs(MIN_SLOTS),
  getInputs: (config) => listInputs(config.slotCount),
  outputs: [{ id: "out", label: "out", dataType: "text" }],
  configParams: {
    mode: { control: "select", options: LIST_MODES, label: "mode" },
    cursor: { control: "number", label: "index" },
  },
  defaultConfig: {
    cursor: 0,
    mode: "fixed",
    slotCount: MIN_SLOTS,
  },
  reactive: true,
  execute: async ({ nodeId, config, inputs }) => {
    // Resolve the upstream array on `items` first, then append one item
    // per wired `slot-N`. We stay in the StandardizedOutput shape (not
    // unwrapped via extractInputArrayByType) so downstream gets the full
    // `{ type, value }` discriminator preserved.
    const raw = inputs.items;
    const arrayItems: StandardizedOutput[] = raw === undefined
      ? []
      : Array.isArray(raw)
        ? (raw as StandardizedOutput[])
        : [raw as StandardizedOutput];

    const slotCount = Math.min(
      MAX_SLOTS,
      Math.max(MIN_SLOTS, config.slotCount ?? MIN_SLOTS),
    );
    const slotItems: StandardizedOutput[] = [];
    for (let i = 0; i < slotCount; i++) {
      const slotRaw = inputs[`${SLOT_PREFIX}${i}`];
      if (slotRaw === undefined) continue;
      const single = Array.isArray(slotRaw) ? slotRaw[0] : slotRaw;
      if (single) slotItems.push(single);
    }

    const list: StandardizedOutput[] = [...arrayItems, ...slotItems];

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

// Exported for tests so the helpers can be exercised without spinning up
// the whole canvas.
export const __testHooks = { listInputs, slotIndex, MIN_SLOTS, MAX_SLOTS };
