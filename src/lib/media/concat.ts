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
 * Video concatenation via mediabunny.
 *
 * Always decode → draw → re-encode onto one H.264 timeline. Remux
 * (packet-copy) kept freezing at the cut: B-frame GOPs, per-clip SPS,
 * and a shorter audio track all make the player stop in the "middle"
 * even when the second clip is in the file. Lengths / aspects do not
 * have to match. Audio is dropped so duration follows the picture.
 */

/**
 * Map a clip-local timestamp onto the joined timeline.
 * `originTs` is this clip's first sample/packet timestamp (often slightly
 * before 0). Subtracting it makes the clip start exactly at `offsetSec`.
 */
export function remuxTimestamp(
  packetTs: number,
  offsetSec: number,
  originTs: number,
): number {
  return Math.max(0, offsetSec + (packetTs - originTs));
}

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

function even(n: number): number {
  const r = Math.round(n);
  return r > 0 ? r - (r % 2) : 2;
}

async function firstClipSize(
  src: Blob | string,
): Promise<{ width: number; height: number }> {
  const input = makeInput(src);
  try {
    const vTrack = await input.getPrimaryVideoTrack();
    if (!vTrack) {
      throw new Error("Wire clips that contain a video track.");
    }
    const sink = new VideoSampleSink(vTrack);
    const sample = await sink.getSample(
      await input.getFirstTimestamp([vTrack]),
    );
    if (!sample) {
      throw new Error("Could not decode the first frame.");
    }
    const width = even(sample.displayWidth);
    const height = even(sample.displayHeight);
    sample.close();
    return { width, height };
  } finally {
    input.dispose();
  }
}

export async function concatVideos(
  srcs: readonly (Blob | string)[],
): Promise<Blob> {
  if (srcs.length === 0) {
    throw new Error("No clips to concatenate.");
  }

  const { width, height } = await firstClipSize(srcs[0]!);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not acquire a 2D context for concat.");
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

  let offsetSec = 0;
  let lastTs = -1;
  for (const src of srcs) {
    const input = makeInput(src);
    try {
      const vTrack = await input.getPrimaryVideoTrack();
      if (!vTrack) continue;
      const sink = new VideoSampleSink(vTrack);
      let origin: number | null = null;
      let clipEnd = 0;
      for await (const sample of sink.samples()) {
        if (origin === null) origin = sample.timestamp;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        const sw = sample.displayWidth;
        const sh = sample.displayHeight;
        const scale = Math.min(width / sw, height / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        sample.draw(ctx, (width - dw) / 2, (height - dh) / 2, dw, dh);
        const dur = sample.duration > 0 ? sample.duration : 1 / 30;
        const t = Math.max(
          lastTs + 1e-4,
          remuxTimestamp(sample.timestamp, offsetSec, origin),
        );
        await videoSource.add(t, dur);
        lastTs = t;
        clipEnd = Math.max(clipEnd, sample.timestamp - origin + dur);
        sample.close();
      }
      const durationSec = await input.computeDuration();
      offsetSec += Math.max(durationSec, clipEnd);
    } finally {
      input.dispose();
    }
  }

  await output.finalize();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) {
    throw new Error("Concat produced no output buffer.");
  }
  return new Blob([buffer], { type: "video/mp4" });
}
