import {
  ALL_FORMATS,
  BlobSource,
  Input,
  UrlSource,
  VideoSampleSink,
} from "mediabunny";

/**
 * Object tracking from a mask video — the geometry layer behind the
 * Object Track Crop + Track Recompose nodes (motion-tracked crop /
 * stabilize / re-composite).
 *
 * The split mirrors the rest of the media layer (`pad-video`, `slice-video`):
 * the WebCodecs-heavy decode lives in `computeMaskTrack` (browser-only,
 * mocked in node tests), and the geometry math (`bboxFromMaskData`,
 * `buildTrack`, `centerAt`) is pure + unit-tested.
 *
 * Everything is in NORMALISED coordinates (0..1) so the mask video and the
 * footage it tracks need not share a resolution — the mask only has to be
 * frame-aligned in time. A "tracked window" is a fixed-size box (sized to
 * contain the object across the whole clip + padding) whose centre follows
 * the smoothed object centroid each frame. Cropping to that window yields a
 * stabilised, object-locked clip; the same window, recomputed from the same
 * mask, is what Recompose inverts to paste an edit back into place.
 */

/** Normalised box (0..1), top-left origin. */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Per-frame smoothed window centre (normalised). */
export interface TrackCenter {
  tSec: number;
  cx: number;
  cy: number;
}

export interface ObjectTrack {
  /** Constant normalised window size sized to contain the object + padding. */
  size: { w: number; h: number };
  /** Per-frame smoothed normalised centre, in ascending time order. */
  centers: TrackCenter[];
}

export interface BuildTrackOptions {
  /** Fractional margin around the largest object box (0.15 = +15%). */
  padding?: number;
  /** Centre-smoothing moving-average window in frames (>=1, treated odd). */
  smoothing?: number;
  /** Luma threshold (0..1) above which a mask pixel counts as foreground. */
  threshold?: number;
}

/**
 * Fixed defaults shared by BOTH the crop and the recompose paths. They are
 * NOT exposed as per-node knobs in v1 on purpose: the recompose step has to
 * recompute the exact same windows the crop produced, so any divergence in
 * padding/smoothing would silently misregister the paste-back. Keeping them
 * as one shared constant makes the two nodes agree by construction.
 */
export const OBJECT_TRACK_DEFAULTS: Required<BuildTrackOptions> = {
  padding: 0.15,
  smoothing: 5,
  threshold: 0.15,
};

/** Longest side (px) the mask is decoded at for the bbox scan — speed knob. */
const MASK_SCAN_MAX_SIDE = 256;

/**
 * Bounding box (normalised) of the foreground region in an RGBA mask frame.
 * Foreground = luma above `threshold`. Returns null when nothing crosses it
 * (fully black frame / object occluded).
 */
export function bboxFromMaskData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = OBJECT_TRACK_DEFAULTS.threshold,
): NormBox | null {
  if (width <= 0 || height <= 0) return null;
  const cutoff = Math.max(0, Math.min(1, threshold)) * 255;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Rec. 601 luma; ignore alpha (masks are opaque white-on-black).
      const luma = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      if (luma > cutoff) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    x: minX / width,
    y: minY / height,
    w: (maxX - minX + 1) / width,
    h: (maxY - minY + 1) / height,
  };
}

/** Centred moving average; `window<=1` is a no-op. Pure. */
export function movingAverage(values: number[], window: number): number[] {
  const w = Math.max(1, Math.floor(window));
  if (w <= 1 || values.length === 0) return values.slice();
  const half = Math.floor(w / 2);
  const out: number[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= values.length) continue;
      sum += values[j]!;
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/**
 * Turn raw per-frame mask boxes into a stable tracked window: one constant
 * size (max box + padding) and a smoothed, in-bounds centre per frame.
 * Null boxes (occlusion / no detection) carry the last known centre forward
 * (and the first valid centre backward) so the window never jumps to a
 * corner. Pure — the unit tests drive it with synthetic boxes.
 */
export function buildTrack(
  frames: { tSec: number; box: NormBox | null }[],
  opts: BuildTrackOptions = {},
): ObjectTrack {
  const padding = opts.padding ?? OBJECT_TRACK_DEFAULTS.padding;
  const smoothing = opts.smoothing ?? OBJECT_TRACK_DEFAULTS.smoothing;

  if (frames.length === 0) {
    return { size: { w: 1, h: 1 }, centers: [] };
  }

  // Largest object extent across the clip → constant window size (+padding).
  let maxW = 0;
  let maxH = 0;
  for (const f of frames) {
    if (!f.box) continue;
    if (f.box.w > maxW) maxW = f.box.w;
    if (f.box.h > maxH) maxH = f.box.h;
  }
  // No detection anywhere → whole-frame passthrough window.
  if (maxW <= 0 || maxH <= 0) {
    return {
      size: { w: 1, h: 1 },
      centers: frames.map((f) => ({ tSec: f.tSec, cx: 0.5, cy: 0.5 })),
    };
  }
  const sizeW = Math.min(1, maxW * (1 + padding));
  const sizeH = Math.min(1, maxH * (1 + padding));

  // Raw centres with carry-forward / back-fill for null frames.
  const rawCx: number[] = new Array(frames.length);
  const rawCy: number[] = new Array(frames.length);
  let lastCx: number | null = null;
  let lastCy: number | null = null;
  for (let i = 0; i < frames.length; i++) {
    const b = frames[i]!.box;
    if (b) {
      lastCx = b.x + b.w / 2;
      lastCy = b.y + b.h / 2;
    }
    rawCx[i] = lastCx ?? 0.5;
    rawCy[i] = lastCy ?? 0.5;
  }
  // Back-fill leading nulls with the first valid centre.
  const firstValid = frames.findIndex((f) => f.box);
  if (firstValid > 0) {
    const cx = rawCx[firstValid]!;
    const cy = rawCy[firstValid]!;
    for (let i = 0; i < firstValid; i++) {
      rawCx[i] = cx;
      rawCy[i] = cy;
    }
  }

  const smCx = movingAverage(rawCx, smoothing);
  const smCy = movingAverage(rawCy, smoothing);

  // Clamp each centre so the fixed window stays fully inside the frame.
  const halfW = sizeW / 2;
  const halfH = sizeH / 2;
  const clamp = (v: number, half: number) =>
    half >= 0.5 ? 0.5 : Math.max(half, Math.min(1 - half, v));

  const centers: TrackCenter[] = frames.map((f, i) => ({
    tSec: f.tSec,
    cx: clamp(smCx[i]!, halfW),
    cy: clamp(smCy[i]!, halfH),
  }));

  return { size: { w: sizeW, h: sizeH }, centers };
}

/** Nearest-in-time centre for a timestamp. Pure. Assumes ascending `centers`. */
export function centerAt(track: ObjectTrack, tSec: number): TrackCenter {
  const { centers } = track;
  if (centers.length === 0) return { tSec, cx: 0.5, cy: 0.5 };
  let best = centers[0]!;
  let bestDelta = Math.abs(best.tSec - tSec);
  for (let i = 1; i < centers.length; i++) {
    const d = Math.abs(centers[i]!.tSec - tSec);
    if (d < bestDelta) {
      best = centers[i]!;
      bestDelta = d;
    } else if (centers[i]!.tSec > tSec && d > bestDelta) {
      break;
    }
  }
  return best;
}

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

/**
 * Decode a mask video and build its object track. Browser-only (WebCodecs):
 * each frame is drawn to a small canvas (longest side `MASK_SCAN_MAX_SIDE`),
 * scanned for the foreground bbox, then `buildTrack` smooths the centres.
 */
export async function computeMaskTrack(
  maskSrc: Blob | string,
  opts: BuildTrackOptions = {},
): Promise<ObjectTrack> {
  const input = makeInput(maskSrc);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("Mask has no video track.");
    const sink = new VideoSampleSink(track);

    const frames: { tSec: number; box: NormBox | null }[] = [];
    let canvas: OffscreenCanvas | null = null;
    let ctx: OffscreenCanvasRenderingContext2D | null = null;
    let scanW = 0;
    let scanH = 0;

    for await (const sample of sink.samples()) {
      if (!canvas) {
        const dw = sample.displayWidth;
        const dh = sample.displayHeight;
        const scale = Math.min(1, MASK_SCAN_MAX_SIDE / Math.max(dw, dh));
        scanW = Math.max(1, Math.round(dw * scale));
        scanH = Math.max(1, Math.round(dh * scale));
        canvas = new OffscreenCanvas(scanW, scanH);
        ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          sample.close();
          throw new Error("Could not acquire a 2D context for the mask scan.");
        }
      }
      ctx!.clearRect(0, 0, scanW, scanH);
      sample.draw(ctx!, 0, 0, scanW, scanH);
      const { data } = ctx!.getImageData(0, 0, scanW, scanH);
      frames.push({
        tSec: sample.timestamp,
        box: bboxFromMaskData(data, scanW, scanH, opts.threshold),
      });
      sample.close();
    }

    return buildTrack(frames, opts);
  } finally {
    input.dispose();
  }
}
