import {
  ALL_FORMATS,
  BlobSource,
  Input,
  UrlSource,
  VideoSampleSink,
} from "mediabunny";

/**
 * Frame extraction via mediabunny — Slice C (multimodal media arc).
 *
 * Pulls a single frame from a video as a PNG Blob. The frame-chain
 * continuity strategy (Slice D) extracts the LAST frame of chunk N and feeds
 * it as the start frame of chunk N+1 (image-to-video) for seamless joins.
 *
 * Browser-only: uses WebCodecs (via mediabunny) + OffscreenCanvas. Not
 * unit-testable in happy-dom — smoke-tested in a real browser.
 */

export type FramePosition = "first" | "last" | { atMs: number };

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

export async function extractFrame(
  src: Blob | string,
  position: FramePosition = "last",
): Promise<Blob> {
  const input = makeInput(src);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      throw new Error("No video track to extract a frame from.");
    }

    let timestampSec: number;
    if (position === "first") {
      timestampSec = await input.getFirstTimestamp([track]);
    } else if (position === "last") {
      const duration = await input.computeDuration([track]);
      // Step just inside the end so getSample lands on the final frame
      // rather than past it.
      timestampSec = Math.max(0, duration - 0.05);
    } else {
      timestampSec = Math.max(0, position.atMs / 1000);
    }

    const sink = new VideoSampleSink(track);
    const sample = await sink.getSample(timestampSec);
    if (!sample) {
      throw new Error("No frame available at the requested position.");
    }

    const width = sample.displayWidth;
    const height = sample.displayHeight;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      sample.close();
      throw new Error("Could not acquire a 2D context for frame extraction.");
    }
    sample.draw(ctx, 0, 0, width, height);
    sample.close();

    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    input.dispose();
  }
}

/**
 * Pull MANY frames in one pass — Slice 7.9.
 *
 * Opens the mediabunny `Input` (and its `VideoSampleSink`) ONCE, then
 * decodes a frame at each requested timestamp. Far cheaper than calling
 * `extractFrame` N times, which would re-demux the whole file per
 * frame. Returns one PNG Blob per timestamp; timestamps that yield no
 * sample (past the end, etc.) are skipped, so the result can be shorter
 * than the input array.
 *
 * Timestamps should be sorted ascending for best decoder locality
 * (`frameTimestampsMs` already emits them in order). Browser-only —
 * same WebCodecs constraints as `extractFrame`.
 */
export async function extractFrames(
  src: Blob | string,
  timestampsMs: number[],
): Promise<Blob[]> {
  const input = makeInput(src);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      throw new Error("No video track to extract frames from.");
    }
    const sink = new VideoSampleSink(track);
    const blobs: Blob[] = [];
    for (const ms of timestampsMs) {
      const timestampSec = Math.max(0, ms / 1000);
      const sample = await sink.getSample(timestampSec);
      if (!sample) continue;
      const width = sample.displayWidth;
      const height = sample.displayHeight;
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        sample.close();
        throw new Error("Could not acquire a 2D context for frame extraction.");
      }
      sample.draw(ctx, 0, 0, width, height);
      sample.close();
      blobs.push(await canvas.convertToBlob({ type: "image/png" }));
    }
    if (blobs.length === 0) {
      throw new Error("No frames could be extracted at the requested times.");
    }
    return blobs;
  } finally {
    input.dispose();
  }
}
