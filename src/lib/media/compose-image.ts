/**
 * Client-side image compositing (canvas) — shared foundation for the Image
 * Concat + Image Crop nodes (and, later, the Compositor).
 *
 * Browser-only: uses `fetch` → `createImageBitmap` → `OffscreenCanvas`. We
 * fetch the bytes and decode via `createImageBitmap` (instead of an <img>
 * with crossOrigin) so the canvas is never tainted and `convertToBlob`
 * always works, even for cross-origin Supabase / CDN URLs. Not unit-testable
 * in happy-dom — exercised through the nodes (mocked in tests, real in a
 * browser).
 */

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Failed to load image (${res.status}) — ${url}`);
  }
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

export type ConcatDirection = "row" | "column";
export type ConcatFit = "min" | "max" | "first";

export interface ConcatImagesOptions {
  /** Lay images left→right ("row") or top→bottom ("column"). Default "row". */
  direction?: ConcatDirection;
  /**
   * How to pick the shared cross-axis size (height for a row, width for a
   * column): smallest ("min", no upscaling — default), largest ("max"), or
   * match the first image ("first"). Every image scales proportionally to it.
   */
  fit?: ConcatFit;
  /** Gap between images, px. Default 0. */
  gap?: number;
  /** Background fill (CSS color). Omit/empty = transparent. */
  background?: string;
}

function pickTarget(values: number[], fit: ConcatFit): number {
  if (fit === "max") return Math.max(...values);
  if (fit === "first") return values[0]!;
  return Math.min(...values);
}

/**
 * Concatenate images into one. A row matches every image's HEIGHT to the
 * chosen target (then lays them side by side); a column matches WIDTH (then
 * stacks). Proportional scaling → no distortion, no one image dwarfing
 * another. Returns a PNG Blob.
 */
export async function concatImages(
  urls: string[],
  opts: ConcatImagesOptions = {},
): Promise<Blob> {
  const direction = opts.direction ?? "row";
  const fit = opts.fit ?? "min";
  const gap = Math.max(0, Math.round(opts.gap ?? 0));
  if (urls.length === 0) throw new Error("No images to concatenate.");

  const bitmaps = await Promise.all(urls.map(loadBitmap));
  try {
    const n = bitmaps.length;
    let width: number;
    let height: number;
    let placements: Array<{ x: number; y: number; w: number; h: number; bmp: ImageBitmap }>;

    if (direction === "row") {
      const targetH = pickTarget(bitmaps.map((b) => b.height), fit);
      const scaled = bitmaps.map((b) => ({
        w: Math.max(1, Math.round(b.width * (targetH / b.height))),
        h: targetH,
        bmp: b,
      }));
      width = scaled.reduce((s, x) => s + x.w, 0) + gap * (n - 1);
      height = targetH;
      let x = 0;
      placements = scaled.map((s) => {
        const p = { x, y: 0, w: s.w, h: s.h, bmp: s.bmp };
        x += s.w + gap;
        return p;
      });
    } else {
      const targetW = pickTarget(bitmaps.map((b) => b.width), fit);
      const scaled = bitmaps.map((b) => ({
        w: targetW,
        h: Math.max(1, Math.round(b.height * (targetW / b.width))),
        bmp: b,
      }));
      width = targetW;
      height = scaled.reduce((s, x) => s + x.h, 0) + gap * (n - 1);
      let y = 0;
      placements = scaled.map((s) => {
        const p = { x: 0, y, w: s.w, h: s.h, bmp: s.bmp };
        y += s.h + gap;
        return p;
      });
    }

    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire a 2D canvas context.");
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, width, height);
    }
    for (const p of placements) ctx.drawImage(p.bmp, p.x, p.y, p.w, p.h);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    for (const b of bitmaps) b.close?.();
  }
}

/** A crop region in normalized [0,1] coordinates of the source image. */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Crop an image to a normalized rect. Returns a PNG Blob. */
export async function cropImage(
  url: string,
  rect: NormalizedRect,
): Promise<Blob> {
  const bmp = await loadBitmap(url);
  try {
    const sx = Math.round(Math.max(0, Math.min(1, rect.x)) * bmp.width);
    const sy = Math.round(Math.max(0, Math.min(1, rect.y)) * bmp.height);
    const sw = Math.max(1, Math.round(rect.w * bmp.width));
    const sh = Math.max(1, Math.round(rect.h * bmp.height));
    const cw = Math.min(sw, bmp.width - sx);
    const ch = Math.min(sh, bmp.height - sy);
    const canvas = new OffscreenCanvas(Math.max(1, cw), Math.max(1, ch));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire a 2D canvas context.");
    ctx.drawImage(bmp, sx, sy, cw, ch, 0, 0, cw, ch);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bmp.close?.();
  }
}

/** How a (non-base) layer maps onto the composite canvas. */
export type LayerFit = "stretch" | "contain" | "cover";

export interface ComposeLayersOptions {
  /**
   * How each layer is scaled onto the canvas. Default "stretch" — draws at
   * the exact canvas size, which is pixel-perfect when a layer shares the
   * base's dimensions (the common "cut a subject out of an image, lay it
   * back over an edited version of that same image" case). "contain" fits
   * inside (letterbox), "cover" fills (crops overflow); both center.
   */
  fit?: LayerFit;
  /** Background fill (CSS color). Omit/empty = transparent. */
  background?: string;
  /**
   * Per-layer opacity in [0,1], indexed to match `urls`. Missing / invalid
   * entries default to 1 (fully opaque). Lets the top cutout be faded
   * without touching the base.
   */
  opacities?: Array<number | undefined>;
}

export interface LayerRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a (srcW × srcH) layer lands on a (canvasW × canvasH) canvas under
 * `fit`, always centered. "stretch" fills the canvas exactly; "contain"
 * scales to fit inside; "cover" scales to fill and overflows. Pure math so
 * it's unit-testable without a real canvas.
 */
export function layerDrawRect(
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  fit: LayerFit,
): LayerRect {
  if (fit === "stretch" || srcW <= 0 || srcH <= 0) {
    return { x: 0, y: 0, w: canvasW, h: canvasH };
  }
  const scale =
    fit === "cover"
      ? Math.max(canvasW / srcW, canvasH / srcH)
      : Math.min(canvasW / srcW, canvasH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}

function drawLayer(
  ctx: OffscreenCanvasRenderingContext2D,
  bmp: ImageBitmap,
  canvasW: number,
  canvasH: number,
  fit: LayerFit,
): void {
  const r = layerDrawRect(bmp.width, bmp.height, canvasW, canvasH, fit);
  ctx.drawImage(bmp, r.x, r.y, r.w, r.h);
}

/**
 * Stack images into one composite, preserving each layer's alpha. The FIRST
 * url is the bottom (base) layer and DEFINES the canvas dimensions; every
 * subsequent url is drawn on top in order. Alpha is preserved so transparent
 * PNG cutouts (e.g. a SAM 3 subject) composite cleanly over a background.
 *
 * Returns a PNG Blob (alpha-capable).
 */
export async function composeLayers(
  urls: string[],
  opts: ComposeLayersOptions = {},
): Promise<Blob> {
  if (urls.length === 0) throw new Error("No layers to compose.");
  const fit = opts.fit ?? "stretch";
  const bitmaps = await Promise.all(urls.map(loadBitmap));
  try {
    const base = bitmaps[0]!;
    const width = Math.max(1, base.width);
    const height = Math.max(1, base.height);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire a 2D canvas context.");
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, width, height);
    }
    for (let i = 0; i < bitmaps.length; i++) {
      const raw = opts.opacities?.[i];
      const alpha =
        typeof raw === "number" && raw >= 0 && raw <= 1 ? raw : 1;
      ctx.globalAlpha = alpha;
      drawLayer(ctx, bitmaps[i]!, width, height, fit);
    }
    ctx.globalAlpha = 1;
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    for (const b of bitmaps) b.close?.();
  }
}
