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

/**
 * Video padding via mediabunny.
 *
 * Some LLM video-input endpoints reject clips below a minimum
 * duration (Marlin / Scribe-v2 / a few of Fal's video understanding
 * models all gate around the 4-second floor). Padding outside our
 * tool means the user has to round-trip through ffmpeg or a desktop
 * editor — exactly the friction this node removes.
 *
 * The strategy is single-pass: we open one MP4 output backed by a
 * `CanvasSource` (h264/avc, source dimensions), draw the first frame
 * to that canvas and emit a held sample for the start-pad seconds,
 * walk the source clip's `VideoSampleSink` and re-encode each frame
 * (offsetting timestamps by the start-pad), then draw the last frame
 * and emit a held sample for the end-pad seconds. Single canvas,
 * single source, single output → no concat / codec-mismatch
 * paperwork. Audio is always discarded — the LLM use case doesn't
 * use it, and silent-pad audio bookkeeping would make this 3× the
 * code without product value.
 *
 * Fast path: when the source already meets `minDurationSec`,
 * `padVideoToMinDuration` returns `{ blob: null, ... }` and the
 * caller can pass the source URL through unchanged. The node body
 * uses this to avoid an unnecessary upload.
 *
 * Browser-only (WebCodecs). Not unit-testable in happy-dom — the
 * helper is mocked at the node-test layer; the math (split / clamp)
 * is exposed as a pure function for unit coverage.
 */

export type PadMode = "start" | "end" | "both";

export interface PadVideoOptions {
  /** Target minimum duration in seconds. Sub-second precision is supported. */
  minDurationSec: number;
  /** Where to add the freeze-frame padding. `"both"` splits the deficit
   *  in half (extra ms goes to the end so total is exact). */
  padMode: PadMode;
  /**
   * Frames per second emitted while holding a single frame.
   * `1` keeps the pad bytes tiny (one keyframe per second is plenty
   *  for a held image) and is the default. Bumping this only helps
   *  if some downstream player can't handle a 1 fps video — none of
   *  our LLM endpoints care.
   */
  holdFps?: number;
}

export interface PadVideoSplit {
  padStartMs: number;
  padEndMs: number;
}

export interface PadVideoResult extends PadVideoSplit {
  /** Padded MP4 blob, or `null` when the source already meets the minimum. */
  blob: Blob | null;
  /** Source duration in milliseconds (round-tripped through `probeMedia`). */
  sourceDurationMs: number;
  /** Final clip duration in milliseconds (`source + padStart + padEnd`). */
  paddedDurationMs: number;
}

/**
 * Split the missing duration between start and end pads according to
 * the pad mode. Pure — exposed so the node body can preview the
 * split before kicking off a real encode.
 */
export function splitPadDuration(
  sourceDurationMs: number,
  minDurationMs: number,
  padMode: PadMode,
): PadVideoSplit {
  const deficit = Math.max(0, minDurationMs - sourceDurationMs);
  if (deficit === 0) return { padStartMs: 0, padEndMs: 0 };
  if (padMode === "start") return { padStartMs: deficit, padEndMs: 0 };
  if (padMode === "end") return { padStartMs: 0, padEndMs: deficit };
  // "both" — half to each side; any odd millisecond goes to the end so
  // total = source + padStart + padEnd is exact.
  const half = Math.floor(deficit / 2);
  return { padStartMs: half, padEndMs: deficit - half };
}

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

export async function padVideoToMinDuration(
  src: Blob | string,
  opts: PadVideoOptions,
): Promise<PadVideoResult> {
  const minDurationMs = Math.max(0, Math.round(opts.minDurationSec * 1000));
  const holdFps = Math.max(1, Math.floor(opts.holdFps ?? 1));
  const stepSec = 1 / holdFps;

  const input = makeInput(src);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      throw new Error("No video track to pad.");
    }
    const sourceDurationSec = await input.computeDuration([track]);
    const sourceDurationMs = Math.round(sourceDurationSec * 1000);

    const { padStartMs, padEndMs } = splitPadDuration(
      sourceDurationMs,
      minDurationMs,
      opts.padMode,
    );

    if (padStartMs === 0 && padEndMs === 0) {
      return {
        blob: null,
        sourceDurationMs,
        paddedDurationMs: sourceDurationMs,
        padStartMs: 0,
        padEndMs: 0,
      };
    }

    const sink = new VideoSampleSink(track);

    // Source dimensions drive the canvas — a frame held at a different
    // size from the source would force the encoder into its
    // size-change-behavior fallback for the actual source samples.
    const firstSample = await sink.getSample(
      await input.getFirstTimestamp([track]),
    );
    if (!firstSample) {
      throw new Error("Could not decode the first frame for padding.");
    }
    const width = firstSample.displayWidth;
    const height = firstSample.displayHeight;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      firstSample.close();
      throw new Error("Could not acquire a 2D context for the pad canvas.");
    }

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

    let cursorSec = 0;

    // ─── Start pad ───
    if (padStartMs > 0) {
      firstSample.draw(ctx, 0, 0, width, height);
      const padSec = padStartMs / 1000;
      const totalFrames = Math.max(1, Math.ceil(padSec * holdFps));
      for (let i = 0; i < totalFrames; i += 1) {
        const t = i * stepSec;
        const remaining = padSec - t;
        if (remaining <= 0) break;
        const dur = Math.min(stepSec, remaining);
        await videoSource.add(cursorSec + t, dur);
      }
      cursorSec += padSec;
    }
    firstSample.close();

    // ─── Source clip (re-encoded with a timestamp offset) ───
    let observedSourceDurSec = 0;
    for await (const sample of sink.samples()) {
      sample.draw(ctx, 0, 0, width, height);
      const t = cursorSec + sample.timestamp;
      const dur = sample.duration > 0 ? sample.duration : stepSec;
      await videoSource.add(t, dur);
      observedSourceDurSec = Math.max(
        observedSourceDurSec,
        sample.timestamp + (sample.duration > 0 ? sample.duration : stepSec),
      );
      sample.close();
    }
    cursorSec += observedSourceDurSec || sourceDurationSec;

    // ─── End pad ───
    if (padEndMs > 0) {
      const lastTimestampSec = Math.max(0, sourceDurationSec - 0.05);
      const lastSample = await sink.getSample(lastTimestampSec);
      if (!lastSample) {
        throw new Error("Could not decode the last frame for padding.");
      }
      lastSample.draw(ctx, 0, 0, width, height);
      const padSec = padEndMs / 1000;
      const totalFrames = Math.max(1, Math.ceil(padSec * holdFps));
      for (let i = 0; i < totalFrames; i += 1) {
        const t = i * stepSec;
        const remaining = padSec - t;
        if (remaining <= 0) break;
        const dur = Math.min(stepSec, remaining);
        await videoSource.add(cursorSec + t, dur);
      }
      lastSample.close();
    }

    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) {
      throw new Error("Pad produced no output buffer.");
    }

    return {
      blob: new Blob([buffer], { type: "video/mp4" }),
      sourceDurationMs,
      paddedDurationMs: sourceDurationMs + padStartMs + padEndMs,
      padStartMs,
      padEndMs,
    };
  } finally {
    input.dispose();
  }
}
