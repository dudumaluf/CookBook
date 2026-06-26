"use client";

import { Grid3x3, Loader2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { ImageContextMenu } from "@/components/nodes/image-context-menu";
import {
  ImagePreviewModal,
  type PreviewModalItem,
} from "@/components/nodes/image-preview-modal";
import { IteratorCursor } from "@/components/nodes/iterator-cursor";
import { DimensionBadge } from "@/components/nodes/media-preview";
import { defineNode } from "@/lib/engine/define-node";
import {
  extractInputArrayByType,
  extractInputByType,
} from "@/lib/engine/extract-input";
import { uploadImageAsset } from "@/lib/library/upload-asset";
import {
  composeImageGrid,
  type GridAnchor,
  type GridFit,
} from "@/lib/media/compose-image-grid";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type {
  ImageRef,
  NodeBodyProps,
  NodeIO,
  StandardizedOutput,
} from "@/types/node";

/**
 * Image Grid — Slice 7.8.
 *
 * Lays N wired images into a uniform-cell rectangular grid. The
 * sockets auto-grow as you wire (same pattern as Image Concat / Video
 * Concat / List). Composition runs entirely client-side in
 * `composeImageGrid()` (canvas) and uploads the result to the asset
 * library.
 *
 * Design choices (from the user-facing question that shipped this
 * node):
 *
 *   - Layout: auto by default (sqrt-ish — 4→2×2, 9→3×3, …) with manual
 *     `cols` / `rows` override in the settings popover. Manual lets
 *     you pin "always 3 across" regardless of input count.
 *   - Cell aspect: dropdown (source / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 /
 *     21:9). "source" reads the first wired image's intrinsic size so
 *     a 16:9 input naturally produces 16:9 cells.
 *   - Fit: cover (default), contain, stretch.
 *   - Anchor: 9-position picker — controls crop region for cover and
 *     letterbox placement for contain.
 *   - Gap + background + outer padding + max-output-edge are all
 *     adjustable; defaults are sensible (0 / 0 / 0 / 2048).
 *
 * Reactive: false. Composing N images on every upstream tick would
 * cause runaway uploads. The user clicks Run once they're happy with
 * the wiring.
 */

const MIN_PORTS = 2;
const PORT_PREFIX = "image-";
/**
 * Dedicated `multiple: true` socket for ARRAY sources (Frames Extract,
 * Image Iterator, List). One edge carries an entire `image[]` and the
 * runner accumulates every item into a single grid execution (the
 * multi-handle branch in run-workflow.ts spreads arrays — no fan-out).
 * Distinct id from the numbered `image-N` single sockets so the
 * auto-grow logic never confuses the two.
 */
const ARRAY_PORT = "images";
const DEFAULT_MAX_OUTPUT_EDGE = 2048;

type GridLayoutMode = "auto" | "manual";

/**
 * Cell-aspect choices. "source" defers to the first wired image's
 * intrinsic ratio (read from `ImageRef.width/height`, or measured
 * from the bitmap as a fallback inside `composeImageGrid`).
 */
type GridCellAspect =
  | "source"
  | "1:1"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "21:9";

const ASPECT_TO_RATIO: Record<Exclude<GridCellAspect, "source">, number> = {
  "1:1": 1,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "21:9": 21 / 9,
};

export interface ImageGridNodeConfig {
  layoutMode?: GridLayoutMode;
  cols?: number;
  rows?: number;
  cellAspect?: GridCellAspect;
  fit?: GridFit;
  anchor?: GridAnchor;
  gap?: number;
  padding?: number;
  background?: string;
  maxOutputEdge?: number;
  /** Auto-growing image sockets count. Always ≥ MIN_PORTS. */
  portCount?: number;
}

function imageInputs(portCount: number | undefined): NodeIO[] {
  const n = Math.max(MIN_PORTS, portCount ?? MIN_PORTS);
  const numbered: NodeIO[] = Array.from({ length: n }, (_, i) => ({
    id: `${PORT_PREFIX}${i}`,
    label: `image ${i + 1}`,
    dataType: "image" as const,
  }));
  // Array socket first so array sources (frames, iterators, lists) land
  // at the top; numbered single sockets below for manual one-by-one
  // wiring. Both feed the same grid — execute merges them.
  return [
    {
      id: ARRAY_PORT,
      label: "images[]",
      dataType: "image" as const,
      multiple: true,
    },
    ...numbered,
  ];
}

function portIndex(handle: string | undefined): number {
  if (!handle?.startsWith(PORT_PREFIX)) return -1;
  const idx = Number(handle.slice(PORT_PREFIX.length));
  return Number.isFinite(idx) ? idx : -1;
}

/**
 * Resolve the configured cell aspect to a numeric width/height ratio.
 * Returns `undefined` for `"source"` so the compositor can fall back
 * to the first bitmap's intrinsic ratio.
 */
function resolveAspect(
  choice: GridCellAspect | undefined,
  firstRef: ImageRef | undefined,
): number | undefined {
  const c = choice ?? "source";
  if (c !== "source") return ASPECT_TO_RATIO[c];
  if (
    firstRef &&
    typeof firstRef.width === "number" &&
    typeof firstRef.height === "number" &&
    firstRef.width > 0 &&
    firstRef.height > 0
  ) {
    return firstRef.width / firstRef.height;
  }
  return undefined;
}

/**
 * Auto-flow grid math: for N images pick the most square-ish cols/rows
 * pair (cols = ceil(sqrt(N)), rows = ceil(N/cols)). Mirrors the math
 * inside `computeGridLayout` — kept here for the body-side preview
 * label so the user can confirm "9 images → 3×3" before running.
 */
function autoFlow(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 1, rows: 1 };
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}

/** Split `items` into consecutive chunks of at most `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function ImageGridBody({
  nodeId,
  config,
  updateConfig,
}: NodeBodyProps<ImageGridNodeConfig>) {
  const record = useExecutionStore((s) => s.records.get(nodeId));
  const status = record?.status;
  const output = record?.output;
  // A run can emit one grid (single) or several pages (array). Normalise
  // to a flat list of page URLs so the body pages through them.
  const pageUrls = useMemo(() => {
    if (!output) return [] as string[];
    const arr = Array.isArray(output) ? output : [output];
    return arr
      .filter(
        (o): o is Extract<StandardizedOutput, { type: "image" }> =>
          o.type === "image" && Boolean(o.value?.url),
      )
      .map((o) => o.value.url);
  }, [output]);
  const pageCount = pageUrls.length;
  // Every page as a modal item so the full-screen preview can flip through
  // multi-page grids with ‹ › / ← → without closing + reopening.
  const modalItems = useMemo<PreviewModalItem[]>(
    () =>
      pageUrls.map((url, i) => ({
        url,
        alt: pageUrls.length > 1 ? `Image grid page ${i + 1}` : "Image grid",
        downloadName: pageUrls.length > 1 ? `image-grid-${i + 1}` : "image-grid",
        checkerboard: true,
      })),
    [pageUrls],
  );

  const [previewOpen, setPreviewOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [dims, setDims] = useState<{ url: string; w: number; h: number } | null>(
    null,
  );
  const safePage = Math.min(Math.max(0, pageIndex), Math.max(0, pageCount - 1));
  const currentUrl = pageCount > 0 ? pageUrls[safePage]! : null;

  const maxConnected = useWorkflowStore((s) => {
    let m = -1;
    for (const e of s.edges) {
      if (e.target === nodeId) m = Math.max(m, portIndex(e.targetHandle));
    }
    return m;
  });
  const hasArraySource = useWorkflowStore((s) =>
    s.edges.some((e) => e.target === nodeId && e.targetHandle === ARRAY_PORT),
  );
  // Always keep one trailing empty slot so users can wire one more.
  const desired = Math.max(MIN_PORTS, maxConnected + 2);
  const current = Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS);
  useEffect(() => {
    if (current !== desired) updateConfig({ portCount: desired });
  }, [current, desired, updateConfig]);

  const wiredCount = maxConnected + 1;

  const layoutMode = config.layoutMode ?? "auto";
  const summary = useMemo(() => {
    if (layoutMode === "manual") {
      const cols = Math.max(1, config.cols ?? 2);
      const rowsPinned = config.rows && config.rows > 0 ? config.rows : null;
      const rows =
        rowsPinned ?? Math.max(1, Math.ceil(Math.max(wiredCount, 1) / cols));
      // Both axes pinned ⇒ fixed capacity ⇒ overflow paginates. We can
      // only predict the page count for numbered sockets; an array
      // source's length is unknown until the run, so leave it to the
      // post-run "page i/n" readout.
      const pages =
        rowsPinned && !hasArraySource && wiredCount > cols * rowsPinned
          ? Math.ceil(wiredCount / (cols * rowsPinned))
          : 1;
      return { cols, rows, pages };
    }
    // Auto + an array source: the frame count is only known at run time,
    // so we can't predict cols×rows. Show it after the run instead.
    if (hasArraySource) return null;
    if (wiredCount <= 0) return null;
    return { ...autoFlow(wiredCount), pages: 1 };
  }, [config.cols, config.rows, layoutMode, wiredCount, hasArraySource]);

  return (
    <div className="flex w-full min-w-[260px] flex-col gap-2 px-3 pb-2.5 pt-0.5">
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Grid3x3 className="h-3 w-3 text-accent" />
        <span>{layoutMode === "manual" ? "manual" : "auto"}</span>
        {summary ? (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span>
              {summary.cols}×{summary.rows}
            </span>
            {summary.pages > 1 ? (
              <>
                <span className="text-muted-foreground/60">·</span>
                <span>{summary.pages} pages</span>
              </>
            ) : null}
          </>
        ) : null}
        <span className="text-muted-foreground/60">·</span>
        <span>cells {config.cellAspect ?? "source"}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>fit {config.fit ?? "cover"}</span>
      </div>
      {status === "error" && record?.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive"
        >
          {record.error}
        </p>
      ) : status === "running" ? (
        <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] px-2 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Composing grid…</span>
        </div>
      ) : currentUrl ? (
        <>
          <div className="relative">
            <ImageContextMenu
              url={currentUrl}
              downloadName={
                pageCount > 1 ? `image-grid-${safePage + 1}` : "image-grid"
              }
            >
              <button
                type="button"
                aria-label={
                  pageCount > 1
                    ? `Preview grid page ${safePage + 1} of ${pageCount}`
                    : "Preview grid"
                }
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setPreviewOpen(true)}
                className="group relative block w-full overflow-hidden rounded-md bg-black/20"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentUrl}
                  alt={pageCount > 1 ? `Grid page ${safePage + 1}` : "Grid"}
                  className="block w-full transition-transform duration-150 group-hover:scale-[1.01]"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                      setDims({
                        url: currentUrl,
                        w: img.naturalWidth,
                        h: img.naturalHeight,
                      });
                    }
                  }}
                />
                <DimensionBadge
                  width={dims?.url === currentUrl ? dims.w : undefined}
                  height={dims?.url === currentUrl ? dims.h : undefined}
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-[11px] font-medium text-transparent transition-colors group-hover:bg-black/30 group-hover:text-white">
                  Click to preview
                </span>
              </button>
            </ImageContextMenu>
            {pageCount > 1 ? (
              <div
                className="absolute inset-x-1 bottom-1 flex justify-center"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <IteratorCursor
                  count={pageCount}
                  cursor={safePage}
                  onCursorChange={setPageIndex}
                  ariaLabelPrefix="Grid page"
                  className="bg-background/75 shadow-sm backdrop-blur-sm"
                />
              </div>
            ) : null}
          </div>
          {previewOpen ? (
            <ImagePreviewModal
              items={modalItems}
              index={safePage}
              onIndexChange={setPageIndex}
              onClose={() => setPreviewOpen(false)}
            />
          ) : null}
        </>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/40 bg-foreground/[0.02] px-2 py-2 text-[11px] text-muted-foreground">
          <Grid3x3 className="h-3 w-3" />
          <span>
            {hasArraySource
              ? wiredCount > 0
                ? `${wiredCount} wired + array source · Run to grid`
                : "Array source wired · Run to grid"
              : wiredCount >= MIN_PORTS
                ? `${wiredCount} images wired · Run to grid`
                : `Wire ${MIN_PORTS - Math.max(0, wiredCount)} more image${MIN_PORTS - Math.max(0, wiredCount) === 1 ? "" : "s"} to grid`}
          </span>
        </div>
      )}
    </div>
  );
}

const ANCHOR_GRID: GridAnchor[][] = [
  ["tl", "tc", "tr"],
  ["ml", "mc", "mr"],
  ["bl", "bc", "br"],
];

function AnchorPicker({
  value,
  onChange,
  disabled,
}: {
  value: GridAnchor;
  onChange: (a: GridAnchor) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid w-fit grid-cols-3 gap-0.5 rounded-md border border-border/60 bg-background/40 p-1">
      {ANCHOR_GRID.flat().map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onChange(a)}
          disabled={disabled}
          aria-label={`Anchor ${a}`}
          aria-pressed={value === a}
          data-testid={`grid-anchor-${a}`}
          className={`h-5 w-5 rounded-sm transition ${
            value === a
              ? "bg-accent/80 ring-1 ring-accent"
              : "bg-foreground/[0.04] hover:bg-foreground/[0.10]"
          } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        />
      ))}
    </div>
  );
}

function ImageGridSettings({
  config,
  updateConfig,
}: NodeBodyProps<ImageGridNodeConfig>) {
  const layoutId = useId();
  const colsId = useId();
  const rowsId = useId();
  const aspectId = useId();
  const fitId = useId();
  const gapId = useId();
  const padId = useId();
  const bgId = useId();
  const maxId = useId();
  const cls =
    "h-7 w-full rounded-md border border-border/60 bg-background/40 px-2 text-xs";
  const layoutMode = config.layoutMode ?? "auto";
  const fit = config.fit ?? "cover";
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={layoutId} className="font-medium text-foreground/90">
          Layout
        </label>
        <select
          id={layoutId}
          value={layoutMode}
          onChange={(e) =>
            updateConfig({ layoutMode: e.target.value as GridLayoutMode })
          }
          className={cls}
        >
          <option value="auto">Auto — fill square-ish (recommended)</option>
          <option value="manual">Manual — set columns &amp; rows</option>
        </select>
      </div>

      {layoutMode === "manual" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={colsId} className="font-medium text-foreground/90">
              Columns
            </label>
            <input
              id={colsId}
              type="number"
              min={1}
              max={12}
              value={config.cols ?? 2}
              onChange={(e) =>
                updateConfig({
                  cols: Math.max(1, Math.min(12, Number(e.target.value) || 1)),
                })
              }
              className={cls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={rowsId} className="font-medium text-foreground/90">
              Rows{" "}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                (blank = grow to fit)
              </span>
            </label>
            <input
              id={rowsId}
              type="number"
              min={0}
              max={12}
              value={config.rows ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                updateConfig({
                  rows: v <= 0 ? undefined : Math.max(1, Math.min(12, v)),
                });
              }}
              className={cls}
            />
          </div>
          <p className="col-span-2 text-[10px] leading-relaxed text-muted-foreground/70">
            Pin both columns and rows to cap each grid (e.g. 3×3 = 9 per
            page). Extra images spill onto more grid pages — 50 images →
            6 pages you can flip through with the arrows. Leave rows blank
            for one grid that grows to fit everything.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={aspectId} className="font-medium text-foreground/90">
          Cell aspect
        </label>
        <select
          id={aspectId}
          value={config.cellAspect ?? "source"}
          onChange={(e) =>
            updateConfig({ cellAspect: e.target.value as GridCellAspect })
          }
          className={cls}
        >
          <option value="source">Source — match first wired image</option>
          <option value="1:1">1:1 — square</option>
          <option value="16:9">16:9 — landscape</option>
          <option value="9:16">9:16 — portrait</option>
          <option value="4:3">4:3</option>
          <option value="3:4">3:4</option>
          <option value="21:9">21:9 — ultrawide</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={fitId} className="font-medium text-foreground/90">
          Fit
        </label>
        <select
          id={fitId}
          value={fit}
          onChange={(e) => updateConfig({ fit: e.target.value as GridFit })}
          className={cls}
        >
          <option value="cover">Cover — fill cell, crop overflow</option>
          <option value="contain">Contain — fit inside, letterbox</option>
          <option value="stretch">Stretch — distort to fill</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-foreground/90">Anchor</span>
        <AnchorPicker
          value={config.anchor ?? "mc"}
          onChange={(a) => updateConfig({ anchor: a })}
          disabled={fit === "stretch"}
        />
        <p className="text-[10px] leading-relaxed text-muted-foreground/70">
          {fit === "stretch"
            ? "Anchor is ignored when fit = stretch."
            : fit === "cover"
              ? "Picks which part of the source image is kept when cropping."
              : "Where the letterboxed image lands inside the cell."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={gapId} className="font-medium text-foreground/90">
            Gap (px)
          </label>
          <input
            id={gapId}
            type="number"
            min={0}
            max={256}
            value={config.gap ?? 0}
            onChange={(e) =>
              updateConfig({
                gap: Math.max(0, Math.min(256, Number(e.target.value) || 0)),
              })
            }
            className={cls}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={padId} className="font-medium text-foreground/90">
            Padding (px)
          </label>
          <input
            id={padId}
            type="number"
            min={0}
            max={512}
            value={config.padding ?? 0}
            onChange={(e) =>
              updateConfig({
                padding: Math.max(
                  0,
                  Math.min(512, Number(e.target.value) || 0),
                ),
              })
            }
            className={cls}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={bgId} className="font-medium text-foreground/90">
          Background
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (blank = transparent)
          </span>
        </label>
        <input
          id={bgId}
          type="text"
          placeholder="#000000 / transparent"
          value={config.background ?? ""}
          onChange={(e) => updateConfig({ background: e.target.value })}
          className={cls}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={maxId} className="font-medium text-foreground/90">
          Max output edge (px)
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            (longer side of canvas)
          </span>
        </label>
        <input
          id={maxId}
          type="number"
          min={256}
          max={8192}
          step={64}
          value={config.maxOutputEdge ?? DEFAULT_MAX_OUTPUT_EDGE}
          onChange={(e) =>
            updateConfig({
              maxOutputEdge: Math.max(
                256,
                Math.min(8192, Number(e.target.value) || DEFAULT_MAX_OUTPUT_EDGE),
              ),
            })
          }
          className={cls}
        />
      </div>
    </div>
  );
}

export const imageGridNodeSchema = defineNode<ImageGridNodeConfig>({
  kind: "image-grid",
  category: "compose",
  title: "Image Grid",
  description:
    "Lay N images into a uniform-cell grid. Wire images one-by-one into the numbered sockets, or feed an array (Frames Extract, Image Iterator, List) into the images[] socket. Auto-flow by default (square-ish), with manual columns/rows override. Pinning BOTH columns and rows caps each grid (e.g. 3×3) and spills overflow onto multiple grid pages you can page through — great for turning 50 images into a stack of 3×3 contact sheets. Pick cell aspect (source / 1:1 / 16:9 / …), fit (cover / contain / stretch), and a 9-position anchor for cropping.",
  icon: Grid3x3,
  // Slice 7.11: multi-page output is a behaviour change that no config
  // edit reflects. Bump so grids cached as a single image before the
  // update recompose into pages instead of replaying the stale result.
  cacheVersion: 2,
  inputs: imageInputs(MIN_PORTS),
  getInputs: (config) => imageInputs(config.portCount),
  outputs: [{ id: "out", label: "out", dataType: "image", multiple: true }],
  defaultConfig: {
    layoutMode: "auto",
    cellAspect: "source",
    fit: "cover",
    anchor: "mc",
    gap: 0,
    padding: 0,
    maxOutputEdge: DEFAULT_MAX_OUTPUT_EDGE,
    portCount: MIN_PORTS,
  },
  configParams: {
    layoutMode: {
      control: "select",
      options: ["auto", "manual"],
      label: "layout",
    },
    cols: { control: "number", label: "columns" },
    rows: { control: "number", label: "rows" },
    cellAspect: {
      control: "select",
      options: ["source", "1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
      label: "cell aspect",
    },
    fit: {
      control: "select",
      options: ["cover", "contain", "stretch"],
      label: "fit",
    },
    anchor: {
      control: "select",
      options: ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"],
      label: "anchor",
    },
    gap: { control: "number", label: "gap (px)" },
    padding: { control: "number", label: "padding (px)" },
    background: { control: "text", label: "background" },
    maxOutputEdge: { control: "number", label: "max edge (px)" },
  },
  reactive: false,
  execute: async ({ config, inputs }) => {
    const n = Math.max(MIN_PORTS, config.portCount ?? MIN_PORTS);
    const refs: ImageRef[] = [];
    // Numbered single sockets first (explicit manual order)…
    for (let i = 0; i < n; i++) {
      const ref = extractInputByType(inputs, `${PORT_PREFIX}${i}`, "image");
      if (ref?.url) refs.push(ref);
    }
    // …then every item from the `images[]` array socket (frames,
    // iterators, lists). The runner already accumulated all upstream
    // arrays into one list on this handle.
    for (const ref of extractInputArrayByType(inputs, ARRAY_PORT, "image")) {
      if (ref?.url) refs.push(ref);
    }
    if (refs.length === 0) {
      throw new Error(
        "Wire at least two images — into the numbered sockets or the images[] array socket.",
      );
    }
    if (refs.length === 1) {
      // Single image — return as-is, no point composing a 1×1 grid.
      return {
        type: "image",
        value: refs[0]!,
      } satisfies StandardizedOutput;
    }

    const layoutMode = config.layoutMode ?? "auto";
    const colsManual =
      layoutMode === "manual" && config.cols && config.cols > 0
        ? config.cols
        : undefined;
    const rowsManual =
      layoutMode === "manual" && config.rows && config.rows > 0
        ? config.rows
        : undefined;

    const aspect = resolveAspect(config.cellAspect, refs[0]);
    const baseOpts = {
      ...(colsManual ? { cols: colsManual } : {}),
      ...(rowsManual ? { rows: rowsManual } : {}),
      ...(aspect !== undefined ? { cellAspect: aspect } : {}),
      fit: config.fit ?? "cover",
      anchor: config.anchor ?? "mc",
      gap: config.gap ?? 0,
      padding: config.padding ?? 0,
      ...(config.background ? { background: config.background } : {}),
      maxOutputEdge: config.maxOutputEdge ?? DEFAULT_MAX_OUTPUT_EDGE,
    } as const;

    // Pagination: when BOTH columns and rows are pinned the grid has a
    // fixed per-page capacity (cols × rows). Rather than DROP the
    // overflow (composeImageGrid's literal-pair behaviour), we lay the
    // images across as many uniform pages as needed — 50 images in a
    // 3×3 → 6 grid images. Every page uses the SAME cols/rows so cell
    // geometry is identical across pages (the last page just has empty
    // trailing cells). Auto / manual-cols-only stay a single grid that
    // grows to fit everything.
    const capacity =
      colsManual && rowsManual ? colsManual * rowsManual : undefined;
    const pages =
      capacity && refs.length > capacity ? chunk(refs, capacity) : [refs];

    // Compose pages sequentially — each page decodes its own bitmaps and
    // frees them before the next, bounding peak memory for large sets
    // (frames cap at 256). Parallel would hold every bitmap at once.
    const uploadedRefs: ImageRef[] = [];
    for (let p = 0; p < pages.length; p++) {
      const blob = await composeImageGrid(
        pages[p]!.map((r) => r.url),
        baseOpts,
      );
      const file = new File([blob], `grid-${p + 1}.png`, {
        type: "image/png",
      });
      const uploaded = await uploadImageAsset(file);
      uploadedRefs.push({ url: uploaded.url, mime: "image/png" });
    }

    if (uploadedRefs.length === 1) {
      return {
        output: { type: "image", value: uploadedRefs[0]! },
        usage: { model: "canvas grid" },
      };
    }
    return {
      output: uploadedRefs.map(
        (ref) => ({ type: "image", value: ref }) satisfies StandardizedOutput,
      ),
      usage: { model: `canvas grid · ${uploadedRefs.length} pages` },
    };
  },
  Body: ImageGridBody,
  settings: { Content: ImageGridSettings },
  size: {
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 720,
    resizable: "both",
  },
});
