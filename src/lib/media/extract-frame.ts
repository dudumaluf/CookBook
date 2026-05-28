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
