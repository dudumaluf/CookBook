/**
 * Composer render — flatten a `ComposerDocument` to a single PNG Blob
 * (ADR-0085, masks ADR-0086). The browser-only counterpart to the pure model
 * in `src/types/composer.ts`.
 *
 * Same recipe as the rest of `src/lib/media/` (`loadBitmap` — CORS-safe fetch
 * → `createImageBitmap`; ADR-0087 — → `OffscreenCanvas` → `convertToBlob`) so
 * cross-origin Supabase/CDN layers never taint the canvas. The transform
 * applied here is identical to the one
 * the editor applies via CSS (`placeLayer` is the shared source of truth) and
 * blend modes go through `canvasBlendMode` — so what you arrange in the editor
 * is exactly what bakes out.
 *
 * Masks (Phase 2): a masked layer is rendered onto a full-canvas scratch, then
 * a MATTE (white + per-pixel coverage in its alpha) is `destination-in`-ed
 * into it, then the masked scratch is composited onto the main canvas with the
 * layer's opacity + blend. Alpha masks read the matte's alpha; luma masks read
 * its luminance; either can be inverted (`maskCoverage`). The matte is drawn
 * with the layer's own transform so it's pinned to the layer box (matches the
 * editor's `mask-size:100% 100%`). Not unit-testable in happy-dom (no
 * OffscreenCanvas) — exercised through the node with mocks, real in a browser;
 * the pure `maskCoverage` + `compositeCacheKey` are tested directly.
 */

import {
  ALL_FORMATS,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  UrlSource,
  type VideoSample,
  VideoSampleSink,
} from "mediabunny";

import {
  canvasBlendMode,
  clamp01,
  docDurationMs,
  docFps,
  docFrameCount,
  layerActiveAt,
  layerOpacityAt,
  layerSourceTimeMs,
  placeLayer,
  type ComposerDocument,
  type ComposerLayer,
  type PlacedLayer,
} from "@/types/composer";

import { extractFrame } from "./extract-frame";
import { loadBitmap } from "./load-bitmap";

/** Anything `ctx.drawImage` accepts, plus its intrinsic size for placement. */
interface Drawable {
  src: CanvasImageSource;
  w: number;
  h: number;
}

const bmpDrawable = (bmp: ImageBitmap): Drawable => ({
  src: bmp,
  w: bmp.width,
  h: bmp.height,
});

/** Nearest even integer ≥ 2 — H.264 requires even output dimensions. */
function evenDim(n: number): number {
  const r = Math.max(2, Math.round(n));
  return r % 2 === 0 ? r : r + 1;
}

export interface RenderCompositeInput {
  doc: ComposerDocument;
  /**
   * Resolved drawable URL per layer id (input/asset/url layers). Solids are
   * drawn from `layer.source.color` and need no entry. Missing/undefined =
   * the layer is skipped (e.g. a disconnected input).
   */
  urls: Record<string, string | undefined>;
  /** Resolved MASK matte URL per layer id (Phase 2). Missing = no mask. */
  maskUrls?: Record<string, string | undefined>;
  /**
   * Media kind per layer id (Phase 3). "video" samples a frame instead of
   * decoding the URL as a still; missing entries default to "image" (back-
   * compat with image-only documents).
   */
  mediaTypes?: Record<string, "image" | "video">;
  /** Media kind per layer id for MASK mattes (a video matte samples a frame). */
  maskMediaTypes?: Record<string, "image" | "video">;
  /**
   * Time (seconds) to sample video layers at — Phase 3 still composite +
   * Phase 4 timeline both render one frame at a playhead. Defaults to 0 (the
   * poster / first frame).
   */
  atSec?: number;
}

/**
 * Decode a drawable to an `ImageBitmap`. Images go through the CORS-safe
 * `loadBitmap` (ADR-0087); videos sample a single frame at `atSec` (the
 * poster by default) via mediabunny and rasterise that — so a video layer
 * composites as a still in the flattened PNG.
 */
async function loadDrawableBitmap(
  url: string,
  mediaType: "image" | "video",
  atSec = 0,
): Promise<ImageBitmap> {
  if (mediaType === "video") {
    const frame = await extractFrame(
      url,
      atSec > 0 ? { atMs: atSec * 1000 } : "first",
    );
    return createImageBitmap(frame);
  }
  return loadBitmap(url);
}

/**
 * Per-pixel mask coverage (0..255) from a matte pixel. Pure so it's unit-
 * tested without a canvas. `alpha` reads the mask's alpha channel; `luma`
 * reads its luminance (premultiplied by its alpha so transparent mask regions
 * never leak coverage); `invert` flips it.
 */
export function maskCoverage(
  r: number,
  g: number,
  b: number,
  a: number,
  mode: "alpha" | "luma",
  invert: boolean,
): number {
  let cov =
    mode === "luma" ? (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255) : a;
  if (invert) cov = 255 - cov;
  return cov < 0 ? 0 : cov > 255 ? 255 : cov;
}

function drawPlaced(
  ctx: OffscreenCanvasRenderingContext2D,
  placed: PlacedLayer,
  paint: () => void,
): void {
  ctx.save();
  ctx.translate(placed.cx, placed.cy);
  ctx.rotate(placed.rad);
  paint();
  ctx.restore();
}

/** A full-canvas matte: white pixels whose ALPHA is the computed coverage. */
function buildMatte(
  mask: Drawable,
  placed: PlacedLayer,
  W: number,
  H: number,
  mode: "alpha" | "luma",
  invert: boolean,
): OffscreenCanvas {
  const m = new OffscreenCanvas(W, H);
  const mctx = m.getContext("2d");
  if (!mctx) throw new Error("Could not acquire a 2D canvas context.");
  drawPlaced(mctx, placed, () =>
    mctx.drawImage(mask.src, -placed.w / 2, -placed.h / 2, placed.w, placed.h),
  );
  const img = mctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const cov = Math.round(
      maskCoverage(d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!, mode, invert),
    );
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
    d[i + 3] = cov;
  }
  mctx.putImageData(img, 0, 0);
  return m;
}

/** Paint a single layer (drawable or solid) into `ctx` at its placed transform. */
function paintLayerDrawable(
  ctx: OffscreenCanvasRenderingContext2D,
  layer: ComposerLayer,
  drawable: Drawable | null,
  placed: PlacedLayer,
): void {
  drawPlaced(ctx, placed, () => {
    if (layer.source.kind === "solid") {
      ctx.fillStyle = layer.source.color ?? "#000000";
      ctx.fillRect(-placed.w / 2, -placed.h / 2, placed.w, placed.h);
    } else if (drawable) {
      ctx.drawImage(drawable.src, -placed.w / 2, -placed.h / 2, placed.w, placed.h);
    }
  });
}

/**
 * Composite one layer onto `ctx` with its transform + blend + opacity, taking
 * the mask path (scratch + matte + `destination-in`) when a mask is present.
 * Shared by the still flatten AND the per-frame video encode so both stay
 * pixel-identical; the only per-frame variable is the resolved `drawable`s +
 * `opacity` (fade-applied in timeline mode). Solids carry a null drawable.
 */
function paintOneLayer(
  ctx: OffscreenCanvasRenderingContext2D,
  layer: ComposerLayer,
  drawable: Drawable | null,
  maskDrawable: Drawable | null,
  W: number,
  H: number,
  opacity: number,
): void {
  if (layer.source.kind !== "solid" && !drawable) return;
  const src =
    layer.source.kind === "solid"
      ? { w: W, h: H }
      : { w: drawable!.w, h: drawable!.h };
  const placed = placeLayer(layer, src.w, src.h, W, H);

  if (layer.mask && maskDrawable) {
    const scratch = new OffscreenCanvas(W, H);
    const sctx = scratch.getContext("2d");
    if (!sctx) throw new Error("Could not acquire a 2D canvas context.");
    paintLayerDrawable(sctx, layer, drawable, placed);
    const matte = buildMatte(
      maskDrawable,
      placed,
      W,
      H,
      layer.mask.mode,
      layer.mask.invert,
    );
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(matte, 0, 0);
    sctx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.globalAlpha = clamp01(opacity);
    ctx.globalCompositeOperation = canvasBlendMode(layer.blendMode);
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
  } else {
    ctx.save();
    ctx.globalAlpha = clamp01(opacity);
    ctx.globalCompositeOperation = canvasBlendMode(layer.blendMode);
    paintLayerDrawable(ctx, layer, drawable, placed);
    ctx.restore();
  }
}

/**
 * Render the document to a PNG (alpha-capable). Bottom layer first. Solids and
 * disconnected inputs are handled inline; bitmaps + mask mattes are pre-loaded
 * in parallel then drawn in z-order. Throws when nothing is drawable so the
 * node can show a friendly "add a layer" message instead of a blank canvas.
 */
export async function renderComposite({
  doc,
  urls,
  maskUrls = {},
  mediaTypes = {},
  maskMediaTypes = {},
  atSec = 0,
}: RenderCompositeInput): Promise<Blob> {
  const W = Math.max(1, Math.round(doc.width));
  const H = Math.max(1, Math.round(doc.height));

  const visible = doc.layers.filter((l) => l.visible);
  const drawable = visible.filter(
    (l) => l.source.kind === "solid" || Boolean(urls[l.id]),
  );
  if (drawable.length === 0) {
    throw new Error("Add or wire at least one visible layer to compose.");
  }

  // Pre-load every bitmap + mask matte in parallel, keyed by layer id.
  const bitmaps = new Map<string, ImageBitmap>();
  const maskBitmaps = new Map<string, ImageBitmap>();
  await Promise.all([
    ...drawable
      .filter((l) => l.source.kind !== "solid")
      .map(async (l) => {
        const url = urls[l.id];
        if (url) {
          bitmaps.set(
            l.id,
            await loadDrawableBitmap(url, mediaTypes[l.id] ?? "image", atSec),
          );
        }
      }),
    ...drawable.map(async (l) => {
      const murl = l.mask ? maskUrls[l.id] : undefined;
      if (murl) {
        maskBitmaps.set(
          l.id,
          await loadDrawableBitmap(murl, maskMediaTypes[l.id] ?? "image", atSec),
        );
      }
    }),
  ]);

  try {
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire a 2D canvas context.");
    if (doc.background) {
      ctx.fillStyle = doc.background;
      ctx.fillRect(0, 0, W, H);
    }

    for (const layer of drawable) {
      const bmp = bitmaps.get(layer.id) ?? null;
      if (layer.source.kind !== "solid" && !bmp) continue;
      const maskBmp = layer.mask ? maskBitmaps.get(layer.id) : undefined;
      paintOneLayer(
        ctx,
        layer,
        bmp ? bmpDrawable(bmp) : null,
        maskBmp ? bmpDrawable(maskBmp) : null,
        W,
        H,
        clamp01(layer.opacity),
      );
    }
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    for (const bmp of bitmaps.values()) bmp.close?.();
    for (const bmp of maskBitmaps.values()) bmp.close?.();
  }
}

/**
 * Stable content key for the reactive render memo + engine cache. Encodes
 * everything that changes the pixels: canvas box, background, and each
 * visible layer's resolved url/color + transform + blend + opacity + fit +
 * mask (url + mode + invert), in z-order. Hidden layers are omitted so
 * toggling visibility re-renders.
 */
export function compositeCacheKey(
  doc: ComposerDocument,
  urls: Record<string, string | undefined>,
  maskUrls: Record<string, string | undefined> = {},
  mediaTypes: Record<string, "image" | "video"> = {},
  atSec = 0,
): string {
  const parts = doc.layers
    .filter((l) => l.visible)
    .map((l) => {
      const kind = mediaTypes[l.id] ?? "image";
      const src =
        l.source.kind === "solid"
          ? `solid:${l.source.color}`
          : `${kind === "video" ? "v:" : ""}${urls[l.id] ?? ""}`;
      const t = l.transform;
      const mask = l.mask
        ? `~${maskUrls[l.id] ?? ""}:${l.mask.mode}:${l.mask.invert ? 1 : 0}`
        : "";
      const ti = l.timing
        ? `=${l.timing.startMs}-${l.timing.endMs}:${l.timing.trimInMs ?? 0}:${
            l.timing.fadeInMs ?? 0
          }:${l.timing.fadeOutMs ?? 0}`
        : "";
      return [
        src,
        l.fit,
        l.blendMode,
        l.opacity.toFixed(3),
        t.xPct.toFixed(4),
        t.yPct.toFixed(4),
        t.scale.toFixed(4),
        Math.round(t.rotationDeg),
        mask,
        ti,
      ].join(",");
    });
  // `atSec` keyed so scrubbing a video layer re-renders the still preview;
  // the timeline signature (duration/fps) flips image↔video output.
  const t = atSec > 0 ? `@${atSec.toFixed(3)}` : "";
  const tl =
    (doc.durationMs ?? 0) > 0 ? `*${doc.durationMs}/${doc.fps ?? 30}` : "";
  return `${doc.width}x${doc.height}${t}${tl}#${doc.background ?? "none"}#${parts.join("|")}`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Timeline mode: per-frame composite → MP4 (Phase 4 / ADR-0091)              */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Opens a video ONCE and seeks a frame per output time — the multi-source
 * mixer's per-layer reader. `getSample` is cheap on monotonically-increasing
 * times (the decoder walks forward), and we clamp past the clip end so a layer
 * that outlives its source HOLDS its last frame rather than vanishing.
 */
class VideoFrameReader {
  private readonly input: Input;
  private ready: Promise<{
    sink: VideoSampleSink;
    durationSec: number;
  }> | null = null;

  constructor(private readonly url: string) {
    this.input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url) });
  }

  private init() {
    if (!this.ready) {
      this.ready = (async () => {
        const track = await this.input.getPrimaryVideoTrack();
        if (!track) {
          throw new Error("A video layer has no decodable video track.");
        }
        const durationSec = await this.input.computeDuration([track]);
        return { sink: new VideoSampleSink(track), durationSec };
      })();
    }
    return this.ready;
  }

  /** The frame displayed at output `tSec` (clamped to the clip), or null. */
  async frameAt(tSec: number): Promise<VideoSample | null> {
    const { sink, durationSec } = await this.init();
    const clamped = Math.max(0, Math.min(tSec, Math.max(0, durationSec - 1e-3)));
    return sink.getSample(clamped);
  }

  dispose(): void {
    this.input.dispose();
  }
}

const sampleDrawable = (s: VideoSample): Drawable => ({
  src: s.toCanvasImageSource(),
  w: s.displayWidth,
  h: s.displayHeight,
});

export interface RenderCompositeVideoInput {
  doc: ComposerDocument;
  urls: Record<string, string | undefined>;
  maskUrls?: Record<string, string | undefined>;
  mediaTypes?: Record<string, "image" | "video">;
  maskMediaTypes?: Record<string, "image" | "video">;
  /** Abort a long encode (the node's Run signal). */
  signal?: AbortSignal;
  /** Encode progress, 0..1, fired once per finished frame. */
  onProgress?: (fraction: number) => void;
}

export interface ComposeVideoResult {
  blob: Blob;
  width: number;
  height: number;
  durationMs: number;
  fps: number;
  frameCount: number;
}

/**
 * Render the document's TIMELINE to an MP4. Same per-layer compositing as the
 * still flatten (`paintOneLayer` — transforms, blend, masks shared), driven
 * per OUTPUT frame: image/solid layers + image masks decode ONCE up front;
 * video layers + video masks open a `VideoFrameReader` and are sampled at
 * `trimIn + (t - start)`. Each layer's opacity is fade-applied (`layerOpacityAt`)
 * and off-screen layers (`layerActiveAt`) are skipped. Browser-only (WebCodecs
 * via mediabunny + OffscreenCanvas); exercised through the node with mocks.
 */
export async function renderCompositeVideo({
  doc,
  urls,
  maskUrls = {},
  mediaTypes = {},
  maskMediaTypes = {},
  signal,
  onProgress,
}: RenderCompositeVideoInput): Promise<ComposeVideoResult> {
  const durMs = docDurationMs(doc);
  if (durMs <= 0) {
    throw new Error("Set a timeline length before exporting a video.");
  }
  const fps = docFps(doc);
  const frameCount = docFrameCount(doc);
  const W = evenDim(doc.width);
  const H = evenDim(doc.height);

  const visible = doc.layers.filter((l) => l.visible);
  const drawableLayers = visible.filter(
    (l) => l.source.kind === "solid" || Boolean(urls[l.id]),
  );
  if (drawableLayers.length === 0) {
    throw new Error("Add or wire at least one visible layer to compose.");
  }

  const bitmaps = new Map<string, ImageBitmap>();
  const maskBitmaps = new Map<string, ImageBitmap>();
  const videoReaders = new Map<string, VideoFrameReader>();
  const maskReaders = new Map<string, VideoFrameReader>();

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };

  try {
    // Decode stills once; open one reader per video layer / video mask.
    await Promise.all([
      ...drawableLayers
        .filter((l) => l.source.kind !== "solid")
        .map(async (l) => {
          const url = urls[l.id];
          if (!url) return;
          if ((mediaTypes[l.id] ?? "image") === "video") {
            videoReaders.set(l.id, new VideoFrameReader(url));
          } else {
            bitmaps.set(l.id, await loadBitmap(url));
          }
        }),
      ...drawableLayers.map(async (l) => {
        const murl = l.mask ? maskUrls[l.id] : undefined;
        if (!murl) return;
        if ((maskMediaTypes[l.id] ?? "image") === "video") {
          maskReaders.set(l.id, new VideoFrameReader(murl));
        } else {
          maskBitmaps.set(l.id, await loadBitmap(murl));
        }
      }),
    ]);
    throwIfAborted();

    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire a 2D canvas context.");

    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });
    const videoSource = new CanvasSource(canvas, {
      codec: "avc",
      bitrate: QUALITY_HIGH,
    });
    output.addVideoTrack(videoSource);
    await output.start();

    const frameDurSec = 1 / fps;
    for (let i = 0; i < frameCount; i++) {
      throwIfAborted();
      const tSec = i / fps;
      const tMs = tSec * 1000;

      ctx.clearRect(0, 0, W, H);
      if (doc.background) {
        ctx.fillStyle = doc.background;
        ctx.fillRect(0, 0, W, H);
      }

      // Samples opened this frame, closed after the canvas is captured.
      const open: VideoSample[] = [];
      for (const layer of drawableLayers) {
        if (!layerActiveAt(layer, tMs, durMs)) continue;
        const opacity = layerOpacityAt(layer, tMs, durMs);
        if (opacity <= 0) continue;

        const srcSec = layerSourceTimeMs(layer, tMs, durMs) / 1000;

        let drawable: Drawable | null = null;
        const reader = videoReaders.get(layer.id);
        if (reader) {
          const sample = await reader.frameAt(srcSec);
          if (sample) {
            open.push(sample);
            drawable = sampleDrawable(sample);
          }
        } else {
          const bmp = bitmaps.get(layer.id);
          if (bmp) drawable = bmpDrawable(bmp);
        }
        if (layer.source.kind !== "solid" && !drawable) continue;

        let maskDrawable: Drawable | null = null;
        if (layer.mask) {
          const mReader = maskReaders.get(layer.id);
          if (mReader) {
            const ms = await mReader.frameAt(srcSec);
            if (ms) {
              open.push(ms);
              maskDrawable = sampleDrawable(ms);
            }
          } else {
            const mb = maskBitmaps.get(layer.id);
            if (mb) maskDrawable = bmpDrawable(mb);
          }
        }

        paintOneLayer(ctx, layer, drawable, maskDrawable, W, H, opacity);
      }

      await videoSource.add(tSec, frameDurSec);
      for (const s of open) s.close();
      onProgress?.((i + 1) / frameCount);
    }

    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("Composer video produced no output buffer.");
    return {
      blob: new Blob([buffer], { type: "video/mp4" }),
      width: W,
      height: H,
      durationMs: Math.round(frameCount * frameDurSec * 1000),
      fps,
      frameCount,
    };
  } finally {
    for (const b of bitmaps.values()) b.close?.();
    for (const b of maskBitmaps.values()) b.close?.();
    for (const r of videoReaders.values()) r.dispose();
    for (const r of maskReaders.values()) r.dispose();
  }
}
