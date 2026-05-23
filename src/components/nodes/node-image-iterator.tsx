"use client";

import { Image as ImageIcon } from "lucide-react";
import { useId } from "react";

import { defineNode } from "@/lib/engine/define-node";
import {
  SELECTION_MODES,
  applySelectionMode,
  type SelectionMode,
  type SelectionRange,
} from "@/lib/iterators/selection-mode";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeBodyProps, StandardizedOutput } from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";

/**
 * Image Iterator (Slice 5.5, ADR-0031) — N images stored INSIDE the node
 * with a selection mode + cursor controlling what gets emitted on a run.
 *
 * Replaces the Slice 4.4b multi-edge design. Storage moved from "edges
 * wired into the `images` handle" to "asset ids in `config.assetIds`",
 * for two reasons:
 *
 *  1. **Direct manipulation**. Users drag images from the library straight
 *     onto the iterator surface (Slice 5.5c) instead of spawning N
 *     standalone Image nodes. The iterator becomes a *bag of references*
 *     with controls — closer to how Weavy / ComfyUI surface multi-asset
 *     inputs.
 *
 *  2. **Selection modes**. The iterator can emit a subset of its bag —
 *     `fixed` (cursor item only), `increment` / `decrement` (advance per
 *     run), `random`, `range`, or `all` (full fan-out, the legacy
 *     behaviour). The cursor is part of the iterator's identity so the
 *     body's preview matches what the next run will actually emit.
 *
 * Engine hookup is unchanged. Schema flag `iterator: true` is still set;
 * the engine fan-outs whenever `execute()` returns a `StandardizedOutput[]`
 * landing on a single-input downstream handle. For modes that emit only
 * one item (`fixed | increment | decrement | random`), the fan-out branch
 * runs once — same code path, same cache contract, just degenerate.
 *
 * Cache key: `{ kind, config, deps }` — config now includes `assetIds`,
 * `cursor`, `selectionMode`, `range`. Changing the cursor in `fixed` mode
 * busts the iterator's hash and every downstream — exactly what we want
 * (user picked a different item, downstream needs to re-run).
 */
export interface ImageIteratorNodeConfig {
  /** Asset ids referenced from the asset store. Order matters — it's the user's order. */
  assetIds: string[];
  /** Pointer into `assetIds` used by `fixed` / `increment` / `decrement` / `random`. */
  cursor: number;
  /** What slice of `assetIds` to emit on a run. See `selection-mode.ts`. */
  selectionMode: SelectionMode;
  /** Inclusive `[start, end]` slice for `selectionMode === "range"`. */
  range?: SelectionRange;
}

function ImageIteratorNodeBody({
  config,
  updateConfig,
}: NodeBodyProps<ImageIteratorNodeConfig>) {
  const assets = useAssetStore((s) => s.assets);
  const assetIds = config.assetIds ?? [];
  const count = assetIds.length;
  const safeCursor = clampCursor(config.cursor ?? 0, count);
  const currentId = assetIds[safeCursor];
  const currentAsset = currentId
    ? assets.find((a) => a.id === currentId && a.kind === "image")
    : undefined;
  const currentUrl =
    currentAsset?.kind === "image" ? currentAsset.source.url : undefined;

  return (
    <div className="flex w-full min-w-[220px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      {count === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Square thumbnail of the current cursor item. Falls through
              to the icon glyph if the asset is missing or its url 404s. */}
          <div className="relative aspect-square w-full overflow-hidden rounded-md bg-foreground/5">
            {currentUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentUrl}
                alt={currentAsset?.name ?? "iterator current"}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                <ImageIcon className="h-8 w-8" />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <IteratorCursor
              count={count}
              cursor={safeCursor}
              ariaLabelPrefix="Image"
              onCursorChange={(next) => updateConfig({ cursor: next })}
            />
            <span
              data-testid="image-iterator-mode-chip"
              className="select-none rounded-md bg-foreground/[0.04] px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
            >
              {config.selectionMode ?? "all"}
            </span>
          </div>
          {currentAsset?.name ? (
            <p
              data-testid="image-iterator-current-name"
              className="truncate px-0.5 text-[10.5px] text-muted-foreground/80"
            >
              {currentAsset.name}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      data-testid="image-iterator-empty"
      className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border/40 bg-foreground/[0.02] text-center"
    >
      <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
      <span className="px-3 text-[11px] leading-tight text-muted-foreground">
        No images yet
      </span>
      <span className="px-3 text-[10px] leading-tight text-muted-foreground/70">
        Drag from the Library to populate
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings popover content                                               */
/* ────────────────────────────────────────────────────────────────────── */

function ImageIteratorSettingsContent({
  config,
  updateConfig,
}: NodeBodyProps<ImageIteratorNodeConfig>) {
  const modeId = useId();
  const startId = useId();
  const endId = useId();

  const count = (config.assetIds ?? []).length;
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

      <div className="rounded-md bg-foreground/[0.04] px-2 py-1.5 text-[10.5px] text-muted-foreground">
        {count === 0
          ? "No images yet — selection mode picks up once images are present."
          : `${count} image${count === 1 ? "" : "s"} available.`}
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

function hasIteratorOverrides(config: ImageIteratorNodeConfig): boolean {
  return (
    (config.selectionMode ?? "all") !== "all" || (config.cursor ?? 0) !== 0
  );
}

export const imageIteratorNodeSchema = defineNode<ImageIteratorNodeConfig>({
  kind: "image-iterator",
  category: "iterator",
  title: "Image Iterator",
  description:
    "Holds N images. Selection mode + cursor pick what gets emitted on a run.",
  icon: ImageIcon,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: {
    assetIds: [],
    cursor: 0,
    selectionMode: "all",
  },
  reactive: true,
  iterator: true,
  execute: async ({ nodeId, config }) => {
    const assetIds = config.assetIds ?? [];
    const store = useAssetStore.getState();
    const refs: StandardizedOutput[] = [];
    for (const id of assetIds) {
      const asset = store.getAsset(id);
      if (asset?.kind !== "image") continue;
      refs.push({ type: "image", value: { url: asset.source.url } });
    }

    const { items, nextCursor } = applySelectionMode({
      items: refs,
      mode: config.selectionMode ?? "all",
      cursor: clampCursor(config.cursor ?? 0, refs.length),
      range: config.range,
    });

    if (
      (config.selectionMode === "increment" ||
        config.selectionMode === "decrement" ||
        config.selectionMode === "random") &&
      nextCursor !== (config.cursor ?? 0) &&
      refs.length > 0
    ) {
      const ws = useWorkflowStore.getState();
      ws.updateNodeConfig<ImageIteratorNodeConfig>(nodeId, {
        cursor: nextCursor,
      });
    }

    return items;
  },
  Body: ImageIteratorNodeBody,
  settings: {
    Content: ImageIteratorSettingsContent,
    hasOverrides: hasIteratorOverrides,
  },
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
