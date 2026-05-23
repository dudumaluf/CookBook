"use client";

import { Image as ImageIcon } from "lucide-react";

import { defineNode } from "@/lib/engine/define-node";
import {
  applySelectionMode,
  type SelectionMode,
  type SelectionRange,
} from "@/lib/iterators/selection-mode";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeBodyProps, StandardizedOutput } from "@/types/node";

/**
 * Image Iterator (Slice 5.5, ADR-0031) — N images stored INSIDE the node
 * with a selection mode + cursor controlling what gets emitted on a run.
 *
 * Replaces the Slice 4.4b multi-edge design. Storage moved from "edges
 * wired into the `images` handle" to "asset ids in `config.assetIds`",
 * for two reasons:
 *
 *  1. **Direct manipulation**. Users drag images from the library straight
 *     onto the iterator surface (or use the body's drop zone, Slice 5.5c)
 *     instead of spawning N standalone Image nodes. The iterator becomes
 *     a *bag of references* with controls — closer to how Weavy / ComfyUI
 *     surface multi-asset inputs.
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
  nodeId,
  config,
}: NodeBodyProps<ImageIteratorNodeConfig>) {
  // Subscribe to the assets so library renames / re-uploads propagate to
  // the body preview without a refresh. Keeping this read narrow (just
  // the resolved current asset) reduces re-render noise on big libraries.
  const assets = useAssetStore((s) => s.assets);
  const assetIds = config.assetIds ?? [];
  const safeCursor = clampCursor(config.cursor ?? 0, assetIds.length);
  const currentId = assetIds[safeCursor];
  const current = currentId
    ? assets.find((a) => a.id === currentId && a.kind === "image")
    : undefined;

  // Slice 5.5a doesn't ship the cursor / selection-mode UI yet — that's
  // 5.5b. The body still needs *something* readable so we surface the
  // count and the current selection mode. The 5.5b body replaces this
  // wholesale with the IteratorCursor component + thumbnail.
  const count = assetIds.length;
  const mode = config.selectionMode ?? "all";

  // Suppress an unused-var lint: `nodeId` is part of the prop contract
  // for body components but Slice 5.5a's body doesn't read it. 5.5c
  // (drop-onto-iterator) will.
  void nodeId;

  return (
    <div className="flex w-full min-w-[220px] flex-col gap-1.5 px-3 pb-2.5 pt-0.5">
      <div
        data-testid="image-iterator-count"
        className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground"
      >
        <ImageIcon className="h-3 w-3 shrink-0 text-accent" />
        <span className="leading-snug">
          {count === 0 ? (
            <>
              <span className="text-foreground/80">No images yet.</span> Drag
              from the library to populate.
            </>
          ) : (
            <>
              <span className="text-foreground/85">
                {count} image{count === 1 ? "" : "s"}
              </span>{" "}
              · mode <span className="text-foreground/80">{mode}</span>
              {current ? (
                <>
                  {" "}
                  · current <span className="text-foreground/70">{current.name}</span>
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

export const imageIteratorNodeSchema = defineNode<ImageIteratorNodeConfig>({
  kind: "image-iterator",
  category: "iterator",
  title: "Image Iterator",
  description:
    "Holds N images. Selection mode + cursor pick what gets emitted on a run.",
  icon: ImageIcon,
  // No more multi-edge `images` input. Storage is internal.
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
    // Resolve asset ids → image refs. Drop ids that don't resolve to an
    // image asset (e.g. user deleted the asset from the library after
    // wiring it into the iterator) so the run doesn't crash on a stale
    // reference.
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

    // Persist the advanced cursor for `increment` / `decrement` / `random`
    // so the next run picks up where this one left off. Skipped for
    // modes whose `nextCursor` equals the input cursor — avoids a
    // gratuitous store write on every run.
    if (
      (config.selectionMode === "increment" ||
        config.selectionMode === "decrement" ||
        config.selectionMode === "random") &&
      nextCursor !== (config.cursor ?? 0) &&
      refs.length > 0
    ) {
      // The workflow store call has to happen on the next tick — Zustand
      // forbids state writes from inside a selector / render path; we're
      // inside execute() (async), so a direct call is fine, but we still
      // queue it via `setState` so cursor-bumps land cleanly.
      const ws = useWorkflowStore.getState();
      // Targeted update keeps the rest of the iterator's config intact.
      ws.updateNodeConfig<ImageIteratorNodeConfig>(nodeId, {
        cursor: nextCursor,
      });
    }

    return items;
  },
  Body: ImageIteratorNodeBody,
  size: {
    defaultWidth: 240,
    minWidth: 220,
    maxWidth: 360,
    resizable: "horizontal",
  },
});

/** Defensive cursor clamp — used by both the body and execute(). */
function clampCursor(cursor: number, count: number): number {
  if (count === 0) return 0;
  if (!Number.isFinite(cursor)) return 0;
  const truncated = Math.trunc(cursor);
  if (truncated < 0) return 0;
  if (truncated >= count) return count - 1;
  return truncated;
}
