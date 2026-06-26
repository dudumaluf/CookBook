/**
 * Client-side image compositing (canvas) — shared foundation for the Image
 * Concat + Image Crop nodes (and, later, the Compositor).
 *
 * Browser-only: uses `loadBitmap` (CORS-safe fetch → `createImageBitmap`;
 * ADR-0087) → `OffscreenCanvas`. We fetch the bytes and decode via
 * `createImageBitmap` (instead of an <img> with crossOrigin) so the canvas is
 * never tainted and `convertToBlob` always works, even for cross-origin
 * Supabase / CDN URLs. Not unit-testable in happy-dom — exercised through the
 * nodes (mocked in tests, real in a browser).
 */

import { loadBitmap } from "./load-bitmap";

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

export interface TransformImageOptions {
  /** Horizontal offset as a percent of width (+ = right). Default 0. */
  translateXPct?: number;
  /** Vertical offset as a percent of height (+ = down). Default 0. */
  translateYPct?: number;
  /** Clockwise rotation in degrees. Default 0. */
  rotationDeg?: number;
  /** Uniform scale as a percent (100 = original size). Default 100. */
  scalePct?: number;
}

export interface ResolvedTransform {
  /** Pixel x-offset of the image center from the canvas center. */
  tx: number;
  /** Pixel y-offset of the image center from the canvas center. */
  ty: number;
  /** Rotation in radians. */
  rad: number;
  /** Scale multiplier (clamped to a sane positive range). */
  scale: number;
}

/**
 * Resolve human transform params (percent of canvas / degrees) into
 * canvas-space pixels + radians for a `width × height` frame. Pure math, so
 * it's unit-testable without a real canvas. Scale is clamped to a positive
 * range so a 0 / negative entry can never collapse or flip the layer.
 */
export function resolveTransform(
  width: number,
  height: number,
  opts: TransformImageOptions,
): ResolvedTransform {
  const tx = ((opts.translateXPct ?? 0) / 100) * width;
  const ty = ((opts.translateYPct ?? 0) / 100) * height;
  const rad = ((opts.rotationDeg ?? 0) * Math.PI) / 180;
  const scale = Math.max(0.01, Math.min(20, (opts.scalePct ?? 100) / 100));
  return { tx, ty, rad, scale };
}

/**
 * True when a transform is a no-op (centered, unrotated, 100%). Lets callers
 * pass the source through untouched instead of re-encoding — preserves the
 * original bytes/quality.
 */
export function isIdentityTransform(opts: TransformImageOptions): boolean {
  return (
    (opts.translateXPct ?? 0) === 0 &&
    (opts.translateYPct ?? 0) === 0 &&
    (opts.rotationDeg ?? 0) === 0 &&
    (opts.scalePct ?? 100) === 100
  );
}

/**
 * Translate / rotate / scale an image around its center while preserving
 * alpha AND the source dimensions — so the result stays pixel-aligned with a
 * same-size background when fed into Image Stack ("cut a subject out, nudge /
 * rotate / resize it, drop it back over the edited frame"). Overflow is
 * clipped to the frame; vacated areas stay transparent. Returns a PNG Blob.
 */
export async function transformImage(
  url: string,
  opts: TransformImageOptions = {},
): Promise<Blob> {
  const bmp = await loadBitmap(url);
  try {
    const width = Math.max(1, bmp.width);
    const height = Math.max(1, bmp.height);
    const { tx, ty, rad, scale } = resolveTransform(width, height, opts);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire a 2D canvas context.");
    // Order matters: move the origin to the image center (+ user offset),
    // then rotate, then scale, then draw the bitmap centered on the origin.
    ctx.translate(width / 2 + tx, height / 2 + ty);
    ctx.rotate(rad);
    ctx.scale(scale, scale);
    ctx.drawImage(bmp, -width / 2, -height / 2, width, height);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bmp.close?.();
  }
}
