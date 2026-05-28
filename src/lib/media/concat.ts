import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  UrlSource,
} from "mediabunny";

/**
 * Video concatenation via mediabunny — Slice D.2 (multimodal media arc).
 *
 * Joins N clips into one MP4 by REMUXING (copying encoded packets, no
 * re-encode), offsetting each clip's timestamps by the running total. This
 * is lossless + fast and the right approach for Seedance chunks, which all
 * share the same codec / resolution / fps (so one decoder config covers the
 * whole output).
 *
 * Browser-only (WebCodecs via mediabunny). Faithful to the documented packet
 * API; verified in a real browser in the test phase (the chunks come from
 * real Seedance generations).
 *
 * Caveat: assumes all clips share the first clip's codec + decoder config.
 * If a future pipeline mixes heterogeneous sources, this needs a re-encode
 * fallback — noted for when that case actually arises.
 */

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

export async function concatVideos(
  srcs: readonly (Blob | string)[],
): Promise<Blob> {
  if (srcs.length === 0) {
    throw new Error("No clips to concatenate.");
  }

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  let videoSource: EncodedVideoPacketSource | null = null;
  let audioSource: EncodedAudioPacketSource | null = null;
  let videoDecoderConfig: VideoDecoderConfig | null = null;
  let audioDecoderConfig: AudioDecoderConfig | null = null;
  let started = false;
  let firstVideoAdd = true;
  let firstAudioAdd = true;
  let videoOffsetSec = 0;
  let audioOffsetSec = 0;

  for (const src of srcs) {
    const input = makeInput(src);
    try {
      const vTrack = await input.getPrimaryVideoTrack();
      const aTrack = await input.getPrimaryAudioTrack();

      // First clip defines the output tracks + decoder configs.
      if (!started) {
        if (vTrack) {
          const codec = await vTrack.getCodec();
          if (codec) {
            videoSource = new EncodedVideoPacketSource(codec);
            output.addVideoTrack(videoSource);
            videoDecoderConfig = await vTrack.getDecoderConfig();
          }
        }
        if (aTrack) {
          const codec = await aTrack.getCodec();
          if (codec) {
            audioSource = new EncodedAudioPacketSource(codec);
            output.addAudioTrack(audioSource);
            audioDecoderConfig = await aTrack.getDecoderConfig();
          }
        }
        await output.start();
        started = true;
      }

      if (vTrack && videoSource) {
        const sink = new EncodedPacketSink(vTrack);
        let lastEnd = 0;
        for await (const packet of sink.packets()) {
          const meta =
            firstVideoAdd && videoDecoderConfig
              ? { decoderConfig: videoDecoderConfig }
              : undefined;
          firstVideoAdd = false;
          await videoSource.add(
            packet.clone({ timestamp: packet.timestamp + videoOffsetSec }),
            meta,
          );
          lastEnd = Math.max(lastEnd, packet.timestamp + packet.duration);
        }
        videoOffsetSec += lastEnd;
      }

      if (aTrack && audioSource) {
        const sink = new EncodedPacketSink(aTrack);
        let lastEnd = 0;
        for await (const packet of sink.packets()) {
          const meta =
            firstAudioAdd && audioDecoderConfig
              ? { decoderConfig: audioDecoderConfig }
              : undefined;
          firstAudioAdd = false;
          await audioSource.add(
            packet.clone({ timestamp: packet.timestamp + audioOffsetSec }),
            meta,
          );
          lastEnd = Math.max(lastEnd, packet.timestamp + packet.duration);
        }
        audioOffsetSec += lastEnd;
      }
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
