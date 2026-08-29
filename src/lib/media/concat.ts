import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  UrlSource,
  VideoSampleSink,
} from "mediabunny";

/**
 * Video concatenation via mediabunny — Slice D.2 (multimodal media arc).
 *
 * Fast path: remux (packet-copy) when every clip shares codec + size.
 * Fallback: re-encode through a canvas when sizes/codecs differ — otherwise
 * the decoder dies at the cut and the player freezes on the last frame of
 * clip 1 (scrub stuck at ~4.5s). Lengths do not have to match.
 *
 * Audio is kept only when every clip has an audio track. A shorter audio
 * track makes browsers treat the file as ending there even if video continues.
 */

/**
 * Map a clip-local packet onto the joined timeline.
 *
 * `originTs` is this clip's first packet timestamp. Many generated MP4s
 * start a few tens of ms *before* 0 (B-frame composition offset / AAC
 * delay). Adding `offset + packetTs` then lands the next clip *before*
 * the previous GOP ended. Subtracting origin makes the clip start
 * exactly at `offsetSec`.
 */
export function remuxTimestamp(
  packetTs: number,
  offsetSec: number,
  originTs: number,
): number {
  return Math.max(0, offsetSec + (packetTs - originTs));
}

export interface ConcatClipProbe {
  codec: string | null;
  width?: number;
  height?: number;
  hasAudio: boolean;
}

/** True when every clip can share one remux decoder config. */
export function clipsCanRemux(clips: readonly ConcatClipProbe[]): boolean {
  const first = clips[0];
  if (!first?.codec || !first.width || !first.height) return false;
  return clips.every(
    (c) =>
      c.codec === first.codec &&
      c.width === first.width &&
      c.height === first.height,
  );
}

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

async function probeClip(src: Blob | string): Promise<ConcatClipProbe> {
  const input = makeInput(src);
  try {
    const vTrack = await input.getPrimaryVideoTrack();
    const aTrack = await input.getPrimaryAudioTrack();
    const cfg = vTrack ? await vTrack.getDecoderConfig() : null;
    return {
      codec: vTrack ? await vTrack.getCodec() : null,
      width: cfg?.codedWidth,
      height: cfg?.codedHeight,
      hasAudio: !!aTrack,
    };
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

  const probes = [];
  for (const src of srcs) probes.push(await probeClip(src));
  const keepAudio = probes.every((p) => p.hasAudio);

  if (!clipsCanRemux(probes)) {
    const w = probes[0]?.width;
    const h = probes[0]?.height;
    if (!w || !h) {
      throw new Error("Wire clips that contain a video track.");
    }
    return concatByReencode(srcs, w, h);
  }

  return concatByRemux(srcs, keepAudio);
}

async function concatByRemux(
  srcs: readonly (Blob | string)[],
  keepAudio: boolean,
): Promise<Blob> {
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  let videoSource: EncodedVideoPacketSource | null = null;
  let audioSource: EncodedAudioPacketSource | null = null;
  let offsetSec = 0;

  for (const src of srcs) {
    const input = makeInput(src);
    try {
      const vTrack = await input.getPrimaryVideoTrack();
      const aTrack = await input.getPrimaryAudioTrack();

      if (!videoSource) {
        const codec = vTrack ? await vTrack.getCodec() : null;
        if (!codec || !vTrack) {
          throw new Error("Wire clips that contain a video track.");
        }
        videoSource = new EncodedVideoPacketSource(codec);
        output.addVideoTrack(videoSource);
        if (keepAudio && aTrack) {
          const aCodec = await aTrack.getCodec();
          if (aCodec) {
            audioSource = new EncodedAudioPacketSource(aCodec);
            output.addAudioTrack(audioSource);
          }
        }
        await output.start();
      }

      let maxEnd = offsetSec;
      if (vTrack && videoSource) {
        const sink = new EncodedPacketSink(vTrack);
        const decoderConfig = await vTrack.getDecoderConfig();
        let origin: number | null = null;
        let first = true;
        for await (const packet of sink.packets()) {
          if (origin === null) origin = packet.timestamp;
          const ts = remuxTimestamp(packet.timestamp, offsetSec, origin);
          await videoSource.add(
            packet.clone({ timestamp: ts }),
            first && decoderConfig ? { decoderConfig } : undefined,
          );
          first = false;
          maxEnd = Math.max(maxEnd, ts + Math.max(0, packet.duration));
        }
      }
      if (keepAudio && aTrack && audioSource) {
        const sink = new EncodedPacketSink(aTrack);
        const decoderConfig = await aTrack.getDecoderConfig();
        let origin: number | null = null;
        let first = true;
        for await (const packet of sink.packets()) {
          if (origin === null) origin = packet.timestamp;
          const ts = remuxTimestamp(packet.timestamp, offsetSec, origin);
          await audioSource.add(
            packet.clone({ timestamp: ts }),
            first && decoderConfig ? { decoderConfig } : undefined,
          );
          first = false;
          maxEnd = Math.max(maxEnd, ts + Math.max(0, packet.duration));
        }
      }
      const durationSec = await input.computeDuration();
      offsetSec = Math.max(offsetSec + durationSec, maxEnd);
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

/** Decode + draw + re-encode so mismatched sizes still join. */
async function concatByReencode(
  srcs: readonly (Blob | string)[],
  width: number,
  height: number,
): Promise<Blob> {
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
  for (const src of srcs) {
    const input = makeInput(src);
    try {
      const vTrack = await input.getPrimaryVideoTrack();
      if (!vTrack) continue;
      const sink = new VideoSampleSink(vTrack);
      let maxEnd = 0;
      for await (const sample of sink.samples()) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        const sw = sample.displayWidth;
        const sh = sample.displayHeight;
        const scale = Math.min(width / sw, height / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        sample.draw(ctx, (width - dw) / 2, (height - dh) / 2, dw, dh);
        const t = offsetSec + Math.max(0, sample.timestamp);
        const dur = sample.duration > 0 ? sample.duration : 1 / 30;
        await videoSource.add(t, dur);
        maxEnd = Math.max(maxEnd, sample.timestamp + dur);
        sample.close();
      }
      const durationSec = await input.computeDuration();
      offsetSec += Math.max(durationSec, maxEnd);
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
