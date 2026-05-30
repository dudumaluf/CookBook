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
