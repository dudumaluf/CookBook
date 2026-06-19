import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from "mediabunny";

import { probeMedia } from "./probe";
import { replaceVideoAudio } from "./replace-audio";

/**
 * Audio → silent (black-screen) video via mediabunny.
 *
 * ByteDance's recommended "singer performance" decomposition delivers the
 * SONG to Seedance through the VIDEO channel — as a solid-black MP4 that
 * carries the audio track but no picture. Wired into Seedance's `@Video1`
 * slot it acts as an audio-only reference (drives lip-sync / rhythm /
 * timing) WITHOUT polluting the visuals, which come from the keyframes.
 * Feeding the song as a raw `@Audio1` AND a motion video into the same call
 * makes the two fight; routing audio-as-black-video sidesteps that.
 *
 * Strategy (single pass, mirrors `pad-video.ts` + `replace-audio.ts`):
 *   1. Probe the audio duration.
 *   2. Render a solid-color (default BLACK) video covering that duration
 *      (a hair longer — `DURATION_PAD_SEC` — so the audio is never
 *      truncated by a slightly-short video) at a low fps (default 2) and
 *      modest resolution (default 720p tall, width from aspectRatio) via a
 *      `CanvasSource` (h264/avc). The canvas is static, so we fill it once
 *      and emit held frames.
 *   3. Mux the original audio onto the black video (`replaceVideoAudio`).
 *
 * Browser-only (WebCodecs). The encode is mocked at the node-test layer;
 * the dimension math (`silentVideoDimensions`) is a pure function exposed
 * for unit coverage in happy-dom.
 */

export type SilentVideoAspectRatio = "16:9" | "9:16" | "1:1";

export interface AudioToSilentVideoOptions {
  /** Output aspect ratio. Default `"16:9"`. */
  aspectRatio?: SilentVideoAspectRatio;
  /** Output height in px (width derived from the aspect ratio). Default 720. */
  height?: number;
  /** Frames per second of the held black frame. Low keeps the file tiny. Default 2. */
  fps?: number;
  /** CSS color string for the solid background. Default black. */
  color?: string;
}

const DEFAULT_ASPECT_RATIO: SilentVideoAspectRatio = "16:9";
const DEFAULT_HEIGHT = 720;
const DEFAULT_FPS = 2;
const DEFAULT_COLOR = "#000000";
/** Extra video time past the audio so a slightly-short clip can't clip the song. */
const DURATION_PAD_SEC = 0.1;

const ASPECT_RATIO_FACTOR: Record<SilentVideoAspectRatio, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
};

/** Round to the nearest EVEN integer (h264 requires even dimensions). */
function toEven(value: number): number {
  const rounded = Math.round(value);
  const safe = Math.max(2, rounded);
  return safe % 2 === 0 ? safe : safe + 1;
}

/**
 * Derive an even `{ width, height }` for a silent-video render from an aspect
 * ratio + target height. Pure — exposed so the dimension math is unit-testable
 * without touching WebCodecs (which is browser-only).
 */
export function silentVideoDimensions(
  aspectRatio: SilentVideoAspectRatio = DEFAULT_ASPECT_RATIO,
  height: number = DEFAULT_HEIGHT,
): { width: number; height: number } {
  const h = toEven(height);
  const w = toEven(h * ASPECT_RATIO_FACTOR[aspectRatio]);
  return { width: w, height: h };
}

export async function audioToSilentVideo(
  audioSrc: Blob | string,
  opts: AudioToSilentVideoOptions = {},
): Promise<Blob> {
  const aspectRatio = opts.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const fps = Math.max(1, Math.floor(opts.fps ?? DEFAULT_FPS));
  const color = opts.color ?? DEFAULT_COLOR;

  const probe = await probeMedia(audioSrc);
  const durationSec = Math.max(0, probe.durationMs / 1000);
  if (durationSec <= 0) {
    throw new Error(
      "Could not read the audio duration — is the file a valid audio track?",
    );
  }
  const videoDurationSec = durationSec + DURATION_PAD_SEC;

  const { width, height } = silentVideoDimensions(aspectRatio, opts.height);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not acquire a 2D context for the black-screen canvas.");
  }
  // Static fill — the picture never changes, so paint once and hold it.
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);

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

  const stepSec = 1 / fps;
  const totalFrames = Math.max(1, Math.ceil(videoDurationSec * fps));
  for (let i = 0; i < totalFrames; i += 1) {
    const t = i * stepSec;
    const remaining = videoDurationSec - t;
    if (remaining <= 0) break;
    const dur = Math.min(stepSec, remaining);
    await videoSource.add(t, dur);
  }

  await output.finalize();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) {
    throw new Error("Black-screen render produced no output buffer.");
  }
  const blackVideo = new Blob([buffer], { type: "video/mp4" });

  // Mux the original audio onto the silent black video.
  return replaceVideoAudio(blackVideo, audioSrc);
}
