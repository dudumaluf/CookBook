"use client";

import { Image as ImageIcon } from "lucide-react";
import { useId, useState } from "react";

import { defineNode } from "@/lib/engine/define-node";
import {
  SELECTION_MODES,
  applySelectionMode,
  type SelectionMode,
  type SelectionRange,
} from "@/lib/iterators/selection-mode";
import {
  ASSET_DRAG_MIME,
  parseAssetDrag,
} from "@/lib/library/asset-drag";
import { handleAssetDrop } from "@/lib/library/handle-asset-drop";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { cn } from "@/lib/utils";
import { aspectFromImageDimensions } from "@/lib/utils/aspect-ratio";
import type { AssetGroupAsset } from "@/types/asset";
import type { NodeBodyProps, StandardizedOutput } from "@/types/node";

import { IteratorCursor } from "./iterator-cursor";

/**
 * Image Iterator (Slice 5.6, ADR-0032) — a *view* over an `AssetGroup`
 * in the library, with a selection mode + cursor controlling what gets
 * emitted on a run.
 *
 * The iterator is **always linked** to an AssetGroup via `config.groupId`.
 * The library is the single source of truth for "which images are in
 * this set"; editing the group there propagates to every iterator on
 * the canvas linked to it. This replaces Slice 5.5's free-floating
 * `assetIds[]` design — see ADR-0032 for the why.
 *
 * Three ways an iterator gets a `groupId`:
 *
 *  1. **Drag a group from the library** → iterator spawns with
 *     `groupId = group.id`. Multiple iterators can point at the same
 *     group; editing the group fans out to all of them.
 *
 *  2. **Drag N images from the library (multi-select)** → an `Untitled`
 *     group is auto-created with `isUntitled: true`, and the iterator
 *     spawns linked to it. Renaming the group flips `isUntitled` to
 *     false (the user opted in to "this is a real group"); deleting
 *     the iterator triggers `cleanupUntitledGroupIfOrphan` so the
 *     auto-group doesn't accumulate as cruft.
 *
 *  3. **Workflow-store v8→v9 migration** materialises an Untitled group
 *     for every legacy iterator that had `assetIds[]` in its config.
 *
 * Engine hookup is unchanged. Schema flag `iterator: true` stays on;
 * `execute()` resolves `groupId → group.assetIds → image refs` at
 * runtime, applies the selection mode, and returns the array. The
 * fan-out branch in run-workflow.ts (ADR-0030) is bit-identical to
 * Slice 5.5.
 *
 * Cache key: `{ kind, config, deps }` — config now reads `{ groupId,
 * cursor, selectionMode, range? }`. Adding/removing images in the
 * linked group bumps the iterator's hash via the standard upstream-
 * resolution path inside execute() (the resolved urls are part of
 * what the next downstream sees), so cached runs replay correctly.
 *
 * "Detach from group" affordance lives in the settings popover (Slice
 * 5.6e): creates a NEW group with `name = "<source> (copy)"` referencing
 * the SAME `image` ids (no byte duplication), then re-links the
 * iterator to the new group. Mirrors Figma's "Detach instance".
 */
export interface ImageIteratorNodeConfig {
  /**
   * Linked `AssetGroup` id. **Always set on a real iterator** (defaults
   * to `""` only as a transient placeholder for the moment between
   * `addNode()` and the dispatcher's `groupId` write).
   */
  groupId: string;
  /** Pointer into `group.assetIds` used by `fixed`/`increment`/`decrement`/`random`. */
  cursor: number;
  /** What slice of `group.assetIds` to emit on a run. See `selection-mode.ts`. */
  selectionMode: SelectionMode;
  /** Inclusive `[start, end]` slice for `selectionMode === "range"`. */
  range?: SelectionRange;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Body                                                                   */
/* ────────────────────────────────────────────────────────────────────── */

function ImageIteratorNodeBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<ImageIteratorNodeConfig>) {
  // Subscribe broadly so library renames / membership changes propagate.
  const assets = useAssetStore((s) => s.assets);
  const group =
    config.groupId && config.groupId.length > 0
      ? (assets.find(
          (a): a is AssetGroupAsset =>
            a.id === config.groupId && a.kind === "asset-group",
        ) ?? undefined)
      : undefined;

  const assetIds = group?.assetIds ?? [];
  const count = assetIds.length;
  const safeCursor = clampCursor(config.cursor ?? 0, count);
  const currentId = assetIds[safeCursor];
  const currentAsset = currentId
    ? assets.find((a) => a.id === currentId && a.kind === "image")
    : undefined;
  const currentUrl =
    currentAsset?.kind === "image" ? currentAsset.source.url : undefined;

  // Slice 5.6.2 — preview reflects the cursor item's true aspect ratio.
  // Linked-asset width/height (set on upload) gives a flicker-free
  // initial render; legacy assets fall back to <img onLoad> measurement.
  const [imgNaturalDimensions, setImgNaturalDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const linkedDims =
    currentAsset?.kind === "image" &&
    currentAsset.width !== undefined &&
    currentAsset.height !== undefined
      ? { width: currentAsset.width, height: currentAsset.height }
      : null;
  const previewDims = linkedDims ?? imgNaturalDimensions;
  const previewCssAspect = previewDims
    ? aspectFromImageDimensions(previewDims.width, previewDims.height)
    : "1 / 1";

  // Slice 5.6.1 — body-level drop handling. Library drags weren't
  // reliably bubbling up to canvas-flow's onDrop when the cursor was
  // over an iterator's body, so the iterator owns its own listeners.
  // Same dispatcher / handler used by the canvas root.
  const [isDropTarget, setIsDropTarget] = useState(false);

  function handleDragOver(event: React.DragEvent) {
    if (!event.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTarget(true);
  }

  function handleDragLeave(event: React.DragEvent) {
    // Only clear when leaving the wrapper itself, not its children.
    if (event.currentTarget === event.target) setIsDropTarget(false);
  }

  function handleDrop(event: React.DragEvent) {
    setIsDropTarget(false);
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME);
    if (!raw) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = parseAssetDrag(raw);
    if (!payload) return;

    // We pass `target` so the dispatcher routes to `append-to-group`
    // when the iterator is linked. If groupId is empty (placeholder
    // iterator), the dispatcher falls through to spawn — but the
    // canvas-flow root is the right surface for that, not the
    // iterator's body. We still call the helper; spawning a node on
    // top of an iterator is rare but harmless (the new node lands at
    // the iterator's position).
    handleAssetDrop({
      payload,
      target: {
        nodeId,
        nodeKind: "image-iterator",
        iteratorGroupId: config.groupId ?? "",
      },
      // The iterator's body has no flow-coords; we use { 0, 0 } for
      // the spawn-fallback case. In practice the iterator only emits
      // `append-to-group` actions, which don't read `position`.
      position: { x: 0, y: 0 },
    });
    // Mirror canvas-flow's library-selection clear so the next click
    // in the library starts fresh.
    useAssetStore.getState().clearAssetSelection();
  }

  return (
    <div
      data-testid="image-iterator-body"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "flex w-full min-w-[220px] flex-col gap-2 px-3 pb-2.5 pt-0.5 transition-colors",
        isDropTarget && "bg-accent/5 ring-1 ring-accent/40 rounded-md",
      )}
    >
      {!group ? (
        <EmptyStateMissingGroup />
      ) : count === 0 ? (
        <EmptyStateEmptyGroup groupName={group.name} />
      ) : (
        <>
          {/* Aspect-ratio-aware thumbnail of the current cursor item.
              Defaults to 1:1 when no dimensions are known yet. Falls
              through to the icon glyph if the asset is missing or its
              url 404s. */}
          <div
            data-testid="image-iterator-preview"
            className="relative w-full overflow-hidden rounded-md bg-foreground/5"
            style={{ aspectRatio: previewCssAspect }}
          >
            {currentUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentUrl}
                alt={currentAsset?.name ?? "iterator current"}
                className="h-full w-full object-cover"
                onLoad={(e) => {
                  if (linkedDims) return;
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setImgNaturalDimensions({
                      width: img.naturalWidth,
                      height: img.naturalHeight,
                    });
                  }
                }}
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

          <div
            data-testid="image-iterator-group-label"
            className="flex items-center gap-1 px-0.5 text-[10.5px] text-muted-foreground/80"
          >
            <span className="truncate">
              <span className="text-foreground/70">{group.name}</span>
              {group.isUntitled ? (
                <span
                  data-testid="image-iterator-untitled-badge"
                  className="ml-1 rounded bg-foreground/[0.05] px-1 py-px text-[9.5px] text-muted-foreground"
                >
                  Untitled
                </span>
              ) : null}
            </span>
            {currentAsset?.name ? (
              <span
                data-testid="image-iterator-current-name"
                className="ml-auto truncate text-muted-foreground/60"
              >
                {currentAsset.name}
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyStateMissingGroup() {
  return (
    <div
      data-testid="image-iterator-empty-no-group"
      className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border/40 bg-foreground/[0.02] text-center"
    >
      <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
      <span className="px-3 text-[11px] leading-tight text-muted-foreground">
        No group linked
      </span>
      <span className="px-3 text-[10px] leading-tight text-muted-foreground/70">
        Drag a Library group or images here to populate
      </span>
    </div>
  );
}

function EmptyStateEmptyGroup({ groupName }: { groupName: string }) {
  return (
    <div
      data-testid="image-iterator-empty-group"
      className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border/40 bg-foreground/[0.02] text-center"
    >
      <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
      <span className="px-3 text-[11px] leading-tight text-muted-foreground">
        Group is empty
      </span>
      <span className="px-3 text-[10px] leading-tight text-muted-foreground/70">
        Drop images here or add to{" "}
        <span className="text-foreground/75">{groupName}</span> in the Library
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Settings popover content                                               */
/* ────────────────────────────────────────────────────────────────────── */

function ImageIteratorSettingsContent({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<ImageIteratorNodeConfig>) {
  const modeId = useId();
  const startId = useId();
  const endId = useId();

  const assets = useAssetStore((s) => s.assets);
  const group =
    config.groupId && config.groupId.length > 0
      ? (assets.find(
          (a): a is AssetGroupAsset =>
            a.id === config.groupId && a.kind === "asset-group",
        ) ?? undefined)
      : undefined;

  const count = group?.assetIds.length ?? 0;
  const mode = config.selectionMode ?? "all";
  const range = config.range;

  // `nodeId` is part of the prop contract; not used in this body.
  void nodeId;

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
        {!group ? (
          "Drag a Library group onto this iterator to link it."
        ) : count === 0 ? (
          <>
            Linked to <span className="text-foreground/80">{group.name}</span>{" "}
            (empty group).
          </>
        ) : (
          <>
            Linked to <span className="text-foreground/80">{group.name}</span>{" "}
            · {count} image{count === 1 ? "" : "s"}.
          </>
        )}
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
    "A view over a Library group. Selection mode + cursor pick what gets emitted on a run.",
  icon: ImageIcon,
  inputs: [],
  outputs: [{ id: "out", label: "out", dataType: "image" }],
  defaultConfig: {
    // Empty groupId is a transient placeholder. The dispatcher
    // (canvas-flow.tsx onDrop) writes a real groupId immediately
    // after `addNode`. AddNodeMenu spawns also use this default; the
    // user then drags a group / N images on top to link.
    groupId: "",
    cursor: 0,
    selectionMode: "all",
  },
  reactive: true,
  iterator: true,
  execute: async ({ nodeId, config }) => {
    const groupId = config.groupId ?? "";
    if (groupId.length === 0) return [];

    const store = useAssetStore.getState();
    const group = store.getAsset(groupId);
    if (!group || group.kind !== "asset-group") return [];

    // Resolve assetIds → image refs. Drop ids that don't resolve to an
    // image asset (defensive against the user removing an asset from
    // the library directly while it's still listed in the group).
    const refs: StandardizedOutput[] = [];
    for (const id of group.assetIds) {
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
    resizable: "both",
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
