/**
 * Client-side image-grid compositing — Slice 7.8.
 *
 * Sibling of `compose-image.ts` (which handles row/column concatenation
 * and crops). Here we lay out N images into a rectangular grid with
 * uniform cells, configurable aspect ratio, fit mode, anchor, gap, and
 * background. Browser-only — uses `createImageBitmap` + `OffscreenCanvas`
 * so the canvas is never tainted (works for cross-origin Supabase URLs).
 *
 * Why a separate module from `compose-image.ts`:
 *
 *   - Different geometry. Concat is "stretch one axis, lay along the
 *     other"; grid is "uniform cells, individual fit per cell".
 *   - Different option surface. The grid needs aspect/fit/anchor
 *     controls that don't apply to concat (and vice versa for `fit`
 *     min/max/first which has no analogue in a uniform grid).
 *   - `loadBitmap` is now the shared CORS-safe loader (ADR-0087), imported
 *     rather than duplicated.
 */

import { loadBitmap } from "./load-bitmap";

/** How a source image maps into its (uniform) cell. */
export type GridFit = "cover" | "contain" | "stretch";

/**
 * 9-position anchor — controls which part of the source image is kept
 * (`fit: "cover"`) or where the letterboxed image lands inside the cell
 * (`fit: "contain"`). For `"stretch"` the anchor is irrelevant since
 * the image fills the cell exactly.
 *
 * Layout:
 *
 *   tl tc tr
 *   ml mc mr
 *   bl bc br
 */
export type GridAnchor =
  | "tl" | "tc" | "tr"
  | "ml" | "mc" | "mr"
  | "bl" | "bc" | "br";

const ANCHOR_TO_FRACTIONS: Record<GridAnchor, { h: number; v: number }> = {
  tl: { h: 0, v: 0 },
  tc: { h: 0.5, v: 0 },
  tr: { h: 1, v: 0 },
  ml: { h: 0, v: 0.5 },
  mc: { h: 0.5, v: 0.5 },
  mr: { h: 1, v: 0.5 },
  bl: { h: 0, v: 1 },
  bc: { h: 0.5, v: 1 },
  br: { h: 1, v: 1 },
};

export interface ComposeImageGridOptions {
  /**
   * Number of columns. The number of rows derives from
   * `ceil(N / cols)` so every wired image lands in a cell.
   * Auto-derived (`ceil(sqrt(N))`) when omitted.
   */
  cols?: number;
  /**
   * Number of rows. When BOTH `cols` and `rows` are set we honour the
   * pair literally — extra images beyond `cols * rows` are dropped
   * (intentional: lets the user pin the layout regardless of input
   * count). When only `cols` is set, `rows = ceil(N / cols)` so every
   * image lands.
   */
  rows?: number;
  /**
   * Numeric `width / height` of each cell. Caller resolves "source"
   * (= use first wired image's aspect) into a number BEFORE calling
   * — this module is dumb on purpose. Default 1 (square).
   */
  cellAspect?: number;
  /** How each image fills its cell. Default "cover". */
  fit?: GridFit;
  /**
   * Where the image is anchored inside its cell. For "cover" this
   * controls which region of the SOURCE is kept; for "contain" it
   * controls where the letterboxed image lands inside the cell.
   * Default "mc" (centre).
   */
  anchor?: GridAnchor;
  /** Pixel gap between cells (and around the outer edge if you want — see `padding`). Default 0. */
  gap?: number;
  /** Outer padding around the grid. Default 0. */
  padding?: number;
  /** Background fill (CSS color). Empty / omitted = transparent. */
  background?: string;
  /**
   * Max length in px for the longer edge of the OUTPUT canvas. The
   * cell size is computed so the final canvas honours this cap on
   * either axis. Default 2048.
   */
  maxOutputEdge?: number;
}

export interface ComputedGridLayout {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  canvasW: number;
  canvasH: number;
  gap: number;
  padding: number;
}

/**
 * Pure layout math, exported so tests can verify the geometry without
 * touching canvas APIs (which happy-dom doesn't implement).
 *
 * Strategy:
 *
 *   - Pick `cols` (auto = ceil(sqrt(n)) for a square-ish grid).
 *   - Pick `rows` (manual override OR ceil(n / cols)).
 *   - Cell aspect is fixed up front.
 *   - Solve for `cellW` so the final canvas (cells + gaps + padding)
 *     fits inside `maxOutputEdge` on both axes — pick the smaller of
 *     the two candidate widths.
 *   - Round to integer pixels (Math.max 1 to avoid 0-width cells).
 */
export function computeGridLayout(
  imageCount: number,
  opts: ComposeImageGridOptions = {},
): ComputedGridLayout {
  const n = Math.max(1, Math.floor(imageCount));
  const aspect = opts.cellAspect && opts.cellAspect > 0 ? opts.cellAspect : 1;
  const gap = Math.max(0, Math.round(opts.gap ?? 0));
  const padding = Math.max(0, Math.round(opts.padding ?? 0));
  const maxEdge = Math.max(64, Math.round(opts.maxOutputEdge ?? 2048));

  const colsManual = opts.cols && opts.cols > 0 ? Math.floor(opts.cols) : null;
  const rowsManual = opts.rows && opts.rows > 0 ? Math.floor(opts.rows) : null;
  const cols = colsManual ?? Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = rowsManual ?? Math.max(1, Math.ceil(n / cols));

  // Available pixel budget on each axis once we subtract gap + padding.
  // We solve for cellW such that:
  //   canvasW = 2*padding + cols*cellW + (cols-1)*gap
  //   canvasH = 2*padding + rows*cellH + (rows-1)*gap
  //   cellH   = cellW / aspect
  // Then pick cellW so max(canvasW, canvasH) === maxEdge.
  const horizontalBudget = maxEdge - 2 * padding - (cols - 1) * gap;
  const verticalBudget = maxEdge - 2 * padding - (rows - 1) * gap;
  const cellW_landscape = horizontalBudget / cols;
  // verticalBudget = rows * (cellW / aspect) ⇒ cellW = verticalBudget * aspect / rows.
  const cellW_portrait = (verticalBudget * aspect) / rows;
  let cellW = Math.min(cellW_landscape, cellW_portrait);
  if (!Number.isFinite(cellW) || cellW <= 0) cellW = 1;
  cellW = Math.max(1, Math.round(cellW));
  const cellH = Math.max(1, Math.round(cellW / aspect));

  const canvasW = 2 * padding + cols * cellW + Math.max(0, cols - 1) * gap;
  const canvasH = 2 * padding + rows * cellH + Math.max(0, rows - 1) * gap;
  return { cols, rows, cellW, cellH, canvasW, canvasH, gap, padding };
}

interface DrawRect {
  /** Source rect on the bitmap (px). */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination rect on the canvas (px). */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Compute where to draw a single image inside its cell given the fit
 * mode + anchor. Pure — exported for tests. Cell origin is in canvas
 * space.
 */
export function placementFor(
  bmpW: number,
  bmpH: number,
  cellX: number,
  cellY: number,
  cellW: number,
  cellH: number,
  fit: GridFit,
  anchor: GridAnchor,
): DrawRect {
  const a = ANCHOR_TO_FRACTIONS[anchor];
  if (fit === "stretch") {
    return {
      sx: 0,
      sy: 0,
      sw: bmpW,
      sh: bmpH,
      dx: cellX,
      dy: cellY,
      dw: cellW,
      dh: cellH,
    };
  }
  if (fit === "contain") {
    const scale = Math.min(cellW / bmpW, cellH / bmpH);
    const drawW = Math.max(1, Math.round(bmpW * scale));
    const drawH = Math.max(1, Math.round(bmpH * scale));
    return {
      sx: 0,
      sy: 0,
      sw: bmpW,
      sh: bmpH,
      dx: Math.round(cellX + (cellW - drawW) * a.h),
      dy: Math.round(cellY + (cellH - drawH) * a.v),
      dw: drawW,
      dh: drawH,
    };
  }
  // cover: fill the cell, crop to anchor.
  const imgRatio = bmpW / bmpH;
  const cellRatio = cellW / cellH;
  let sw: number;
  let sh: number;
  if (imgRatio > cellRatio) {
    // Image wider than cell — crop horizontally.
    sh = bmpH;
    sw = Math.max(1, Math.round(bmpH * cellRatio));
  } else {
    // Image taller than (or equal to) cell — crop vertically.
    sw = bmpW;
    sh = Math.max(1, Math.round(bmpW / cellRatio));
  }
  const sx = Math.round((bmpW - sw) * a.h);
  const sy = Math.round((bmpH - sh) * a.v);
  return {
    sx,
    sy,
    sw,
    sh,
    dx: cellX,
    dy: cellY,
    dw: cellW,
    dh: cellH,
  };
}

/**
 * Compose N images into a uniform-cell grid. Returns a PNG Blob.
 *
 * Throws on `urls.length === 0`. With exactly one URL this still
 * returns a 1×1 grid (callers that want to skip the render in that
 * case should check the count themselves — the node does).
 */
export async function composeImageGrid(
  urls: string[],
  opts: ComposeImageGridOptions = {},
): Promise<Blob> {
  if (urls.length === 0) throw new Error("No images to grid.");
  const fit = opts.fit ?? "cover";
  const anchor = opts.anchor ?? "mc";
  const bitmaps = await Promise.all(urls.map(loadBitmap));
  try {
    // Resolve "source" aspect from the first image when caller passes
    // 0 / NaN / undefined. The node layer turns the dropdown choice
    // into a number; this fallback is the last line of defence.
    const aspect =
      opts.cellAspect && opts.cellAspect > 0
        ? opts.cellAspect
        : bitmaps[0]!.height > 0
          ? bitmaps[0]!.width / bitmaps[0]!.height
          : 1;

    const layout = computeGridLayout(bitmaps.length, {
      ...opts,
      cellAspect: aspect,
    });
    const { cols, rows, cellW, cellH, canvasW, canvasH, gap, padding } =
      layout;

    const canvas = new OffscreenCanvas(
      Math.max(1, canvasW),
      Math.max(1, canvasH),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire a 2D canvas context.");
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    const cellCount = cols * rows;
    for (let i = 0; i < bitmaps.length && i < cellCount; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const cellX = padding + c * (cellW + gap);
      const cellY = padding + r * (cellH + gap);
      const bmp = bitmaps[i]!;
      const p = placementFor(
        bmp.width,
        bmp.height,
        cellX,
        cellY,
        cellW,
        cellH,
        fit,
        anchor,
      );
      ctx.drawImage(bmp, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
    }
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    for (const b of bitmaps) b.close?.();
  }
}
