/**
 * Image + video resizing to an explicit pixel size, with the four fitting
 * modes a creative pipeline actually needs.
 *
 * Modes (shared by both media types):
 *   - `contain` — scale to fit *inside* the W×H box, preserve aspect, pad the
 *      remainder (letterbox). Output is exactly W×H. Images pad transparent
 *      (or a chosen background); videos pad black.
 *   - `cover`   — scale to *fill* the W×H box, preserve aspect, crop the
 *      overflow (centered). Output is exactly W×H.
 *   - `stretch` — scale to exactly W×H, ignoring aspect (distorts).
 *   - `scale`   — scale to fit *inside* W×H, preserve aspect, **no padding**.
 *      Output is the scaled size (≤ box). Leave width OR height blank/0 to
 *      derive it from the other (the "make this 1920 wide, keep ratio" case).
 *
 * Image path: `loadBitmap` (CORS-safe fetch — direct, then same-origin
 * proxy fallback; ADR-0087) → `createImageBitmap` → `OffscreenCanvas`
 * (untainted, so `convertToBlob` works for cross-origin Supabase/CDN URLs) →
 * PNG Blob.
 * Video path: mediabunny `Conversion`, which natively resizes via
 * `video: { width, height, fit }` AND copies/transcodes the audio track for
 * free (no manual frame loop). Both are browser-only (WebCodecs / canvas);
 * the pure geometry below is unit-testable without either.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  UrlSource,
} from "mediabunny";

import { loadBitmap } from "./load-bitmap";
import { probeMedia } from "./probe";

export type ResizeMode = "contain" | "cover" | "stretch" | "scale";

export interface ResizeGeometry {
  /** Final output dimensions (the resulting media size, in px). */
  outW: number;
  outH: number;
  /** Where the source is painted inside the output canvas (px). */
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
}

/**
 * Resolve a resize request into concrete output dimensions + a source draw
 * rectangle. Pure math — the single source of truth shared by the image
 * canvas path, the video conversion path, and the unit tests.
 *
 * `reqW` / `reqH` of 0, negative, or undefined mean "unset": in `scale` mode
 * an unset dimension is derived from the other; in the box modes
 * (`contain` / `cover` / `stretch`) an unset dimension falls back to the
 * source's so a single-axis request still does something sane.
 */
export function resolveResize(
  srcW: number,
  srcH: number,
  reqW: number | undefined,
  reqH: number | undefined,
  mode: ResizeMode,
): ResizeGeometry {
  const sw = Math.max(1, Math.round(srcW));
  const sh = Math.max(1, Math.round(srcH));
  const w = reqW && reqW > 0 ? Math.round(reqW) : 0;
  const h = reqH && reqH > 0 ? Math.round(reqH) : 0;

  if (mode === "scale") {
    // Keep ratio, no padding — output IS the scaled source.
    let scale: number;
    if (w > 0 && h > 0) scale = Math.min(w / sw, h / sh);
    else if (w > 0) scale = w / sw;
    else if (h > 0) scale = h / sh;
    else scale = 1; // neither axis given → identity
    const outW = Math.max(1, Math.round(sw * scale));
    const outH = Math.max(1, Math.round(sh * scale));
    return { outW, outH, drawX: 0, drawY: 0, drawW: outW, drawH: outH };
  }

  // contain / cover / stretch → an exact W×H box.
  const boxW = w > 0 ? w : sw;
  const boxH = h > 0 ? h : sh;

  if (mode === "stretch") {
    return { outW: boxW, outH: boxH, drawX: 0, drawY: 0, drawW: boxW, drawH: boxH };
  }

  const scale =
    mode === "cover"
      ? Math.max(boxW / sw, boxH / sh)
      : Math.min(boxW / sw, boxH / sh);
  const drawW = sw * scale;
  const drawH = sh * scale;
  return {
    outW: boxW,
    outH: boxH,
    drawX: (boxW - drawW) / 2,
    drawY: (boxH - drawH) / 2,
    drawW,
    drawH,
  };
}

export interface ResizeImageOptions {
  /** Target width in px. 0 / undefined = unset (see `resolveResize`). */
  width?: number;
  /** Target height in px. 0 / undefined = unset. */
  height?: number;
  mode: ResizeMode;
  /**
   * CSS color painted behind the image (the letterbox bars in `contain`).
   * Omit / empty for a transparent background (PNG alpha).
   */
  background?: string;
}

/**
 * Resize an image to an explicit pixel size under `mode`. Returns a PNG Blob
 * (alpha-capable so `contain` can letterbox transparent). Browser-only.
 */
export async function resizeImage(
  url: string,
  opts: ResizeImageOptions,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await loadBitmap(url);
  try {
    const g = resolveResize(bmp.width, bmp.height, opts.width, opts.height, opts.mode);
    const canvas = new OffscreenCanvas(g.outW, g.outH);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire a 2D canvas context.");
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, g.outW, g.outH);
    }
    // Better quality when down-scaling (the common case).
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, g.drawX, g.drawY, g.drawW, g.drawH);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return { blob, width: g.outW, height: g.outH };
  } finally {
    bmp.close?.();
  }
}

export interface ResizeVideoOptions {
  width?: number;
  height?: number;
  mode: ResizeMode;
}

/** Map our box modes onto mediabunny's `fit` values. */
const MODE_FIT: Record<
  Exclude<ResizeMode, "scale">,
  "contain" | "cover" | "fill"
> = {
  contain: "contain",
  cover: "cover",
  stretch: "fill",
};

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

/**
 * Resize a video to an explicit pixel size under `mode`, keeping the audio
 * track. Returns an MP4 Blob + the final dimensions. mediabunny's
 * `Conversion` does the heavy lifting (resize via `fit`, audio copied unless
 * absent). Browser-only.
 *
 * `scale` resolves to concrete dimensions first (preserving aspect) and then
 * uses `fill` — the box already matches the source ratio, so nothing
 * distorts.
 */
export async function resizeVideo(
  src: string | Blob,
  opts: ResizeVideoOptions,
): Promise<{ blob: Blob; width: number; height: number }> {
  const probe = await probeMedia(src);
  if (!probe.width || !probe.height) {
    throw new Error("Could not read the source video's dimensions.");
  }
  const g = resolveResize(probe.width, probe.height, opts.width, opts.height, opts.mode);

  const input = makeInput(src);
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  try {
    const fit = opts.mode === "scale" ? "fill" : MODE_FIT[opts.mode];
    const conversion = await Conversion.init({
      input,
      output,
      video: { width: g.outW, height: g.outH, fit },
      // Audio is intentionally left untouched (kept / transcoded as needed).
    });
    if (!conversion.isValid) {
      throw new Error(
        "This video can't be resized in the browser (unsupported codec). Try a standard MP4 / H.264 source.",
      );
    }
    await conversion.execute();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("Resize produced no output buffer.");
    return {
      blob: new Blob([buffer], { type: "video/mp4" }),
      width: g.outW,
      height: g.outH,
    };
  } finally {
    input.dispose();
  }
}
