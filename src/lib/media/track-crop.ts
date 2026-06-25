import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  UrlSource,
  VideoSampleSink,
} from "mediabunny";
import {
  type BuildTrackOptions,
  centerAt,
  computeMaskTrack,
} from "./object-track";

/**
 * Object Track Crop — crop the footage to a fixed-size window that follows
 * the masked object, producing a stabilised, object-locked clip.
 *
 * The window size is constant (sized by `computeMaskTrack` to contain the
 * object across the whole clip + padding); only its centre moves, tracking
 * the smoothed mask centroid. We keep the object centred even at the frame
 * edge by drawing the whole source frame shifted so the window's top-left
 * lands at (0,0) and letting the canvas clip — uncovered area stays black.
 * That black-fill (rather than clamping the window inside the frame) is what
 * makes Recompose able to invert the exact same geometry.
 *
 * Audio is dropped: the crop is an intermediate you edit, then Recompose
 * pastes back into the original footage (which still carries the audio).
 *
 * Browser-only (WebCodecs); mocked at the node-test layer.
 */

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

/** Nearest even integer >= 2 — H.264 requires even dimensions. */
function evenDim(n: number): number {
  const r = Math.max(2, Math.round(n));
  return r % 2 === 0 ? r : r + 1;
}

export interface CropVideoResult {
  blob: Blob;
  width: number;
  height: number;
  durationMs: number;
}

export async function cropVideoToTrack(
  videoSrc: Blob | string,
  maskSrc: Blob | string,
  opts: BuildTrackOptions = {},
): Promise<CropVideoResult> {
  const track = await computeMaskTrack(maskSrc, opts);

  const input = makeInput(videoSrc);
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("No video track to crop.");
    const sink = new VideoSampleSink(videoTrack);

    let canvas: OffscreenCanvas | null = null;
    let ctx: OffscreenCanvasRenderingContext2D | null = null;
    let output: Output | null = null;
    let videoSource: CanvasSource | null = null;
    let origW = 0;
    let origH = 0;
    let outW = 0;
    let outH = 0;
    let lastEndSec = 0;

    for await (const sample of sink.samples()) {
      if (!canvas) {
        origW = sample.displayWidth;
        origH = sample.displayHeight;
        outW = evenDim(track.size.w * origW);
        outH = evenDim(track.size.h * origH);
        canvas = new OffscreenCanvas(outW, outH);
        ctx = canvas.getContext("2d");
        if (!ctx) {
          sample.close();
          throw new Error("Could not acquire a 2D context for the crop.");
        }
        output = new Output({
          format: new Mp4OutputFormat(),
          target: new BufferTarget(),
        });
        videoSource = new CanvasSource(canvas, {
          codec: "avc",
          bitrate: QUALITY_HIGH,
        });
        output.addVideoTrack(videoSource);
        await output.start();
      }

      const c = centerAt(track, sample.timestamp);
      const srcXpx = (c.cx - track.size.w / 2) * origW;
      const srcYpx = (c.cy - track.size.h / 2) * origH;

      ctx!.fillStyle = "#000";
      ctx!.fillRect(0, 0, outW, outH);
      // Draw the whole frame shifted so the tracked window maps to (0,0);
      // the canvas clips the rest, black shows through outside the frame.
      sample.draw(ctx!, -srcXpx, -srcYpx, origW, origH);

      const dur = sample.duration > 0 ? sample.duration : 1 / 30;
      await videoSource!.add(sample.timestamp, dur);
      lastEndSec = Math.max(lastEndSec, sample.timestamp + dur);
      sample.close();
    }

    if (!output || !videoSource) {
      throw new Error("Could not decode any frame to crop.");
    }

    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("Crop produced no output buffer.");

    return {
      blob: new Blob([buffer], { type: "video/mp4" }),
      width: outW,
      height: outH,
      durationMs: Math.round(lastEndSec * 1000),
    };
  } finally {
    input.dispose();
  }
}
