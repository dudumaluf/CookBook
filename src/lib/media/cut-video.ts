import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSampleSink,
  type VideoSample,
} from "mediabunny";

import {
  keepSegments,
  outputDurationFromCuts,
  sourceTimeFromCuts,
  type CutPin,
} from "./cut-pins";
import { fetchMediaBlob } from "./load-bitmap";
import { outputFrameCount } from "./time-remap";

/**
 * Ripple-delete ranges from a clip and re-encode the leftover as one MP4.
 * Audio is dropped (same as Speed Ramp / Concat).
 */

export interface CutVideoResult {
  blob: Blob;
  durationMs: number;
  width: number;
  height: number;
}

function even(n: number): number {
  const r = Math.round(n);
  return r > 0 ? r - (r % 2) : 2;
}

function nearestIndex(times: readonly number[], t: number): number {
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1]! - t) <= Math.abs(times[lo]! - t)) {
    return lo - 1;
  }
  return lo;
}

export async function cutVideo(
  src: Blob | string,
  pins: readonly CutPin[],
  fps = 30,
): Promise<CutVideoResult> {
  const blob = typeof src === "string" ? await fetchMediaBlob(src) : src;
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(blob),
  });
  try {
    const vTrack = await input.getPrimaryVideoTrack();
    if (!vTrack) {
      throw new Error("Wire a clip that contains a video track.");
    }
    const srcDurSec = await input.computeDuration([vTrack]);
    if (srcDurSec <= 0) {
      throw new Error("Could not read the source duration.");
    }
    const keep = keepSegments(pins, srcDurSec);
    if (keep.length === 0) {
      throw new Error("Keep at least one zone — everything is marked Cut out.");
    }
    const outDurSec = outputDurationFromCuts(pins, srcDurSec);
    if (outDurSec <= 0) {
      throw new Error("Keep at least one zone — everything is marked Cut out.");
    }
    const rate = fps > 0 ? fps : 30;
    const framesN = outputFrameCount(outDurSec, rate);
    const frameDur = 1 / rate;

    const sink = new VideoSampleSink(vTrack);
    const samples: VideoSample[] = [];
    const times: number[] = [];
    for await (const sample of sink.samples()) {
      samples.push(sample);
      times.push(sample.timestamp);
    }
    if (samples.length === 0) {
      throw new Error("Could not decode any frames from the source.");
    }

    const width = even(samples[0]!.displayWidth);
    const height = even(samples[0]!.displayHeight);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not acquire a 2D context for the cut.");
    }

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new BufferTarget(),
    });
    const videoSource = new CanvasSource(canvas, {
      codec: "avc",
      bitrate: QUALITY_HIGH,
      keyFrameInterval: 1,
    });
    output.addVideoTrack(videoSource);
    await output.start();

    try {
      for (let i = 0; i < framesN; i++) {
        const srcSec = sourceTimeFromCuts(pins, i * frameDur, srcDurSec);
        const idx = nearestIndex(times, srcSec);
        const sample = samples[Math.max(0, idx)]!;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        const sw = sample.displayWidth;
        const sh = sample.displayHeight;
        const scale = Math.min(width / sw, height / sh);
        sample.draw(
          ctx,
          (width - sw * scale) / 2,
          (height - sh * scale) / 2,
          sw * scale,
          sh * scale,
        );
        await videoSource.add(
          i * frameDur,
          frameDur,
          i === 0 || i % Math.round(rate) === 0 ? { keyFrame: true } : undefined,
        );
      }
    } finally {
      for (const sample of samples) sample.close();
    }

    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) {
      throw new Error("Cut produced no output buffer.");
    }
    return {
      blob: new Blob([buffer], { type: "video/mp4" }),
      durationMs: Math.round(outDurSec * 1000),
      width,
      height,
    };
  } finally {
    input.dispose();
  }
}
