import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  UrlSource,
} from "mediabunny";

/**
 * Replace a video's audio track with audio from another file (client-side mux).
 *
 * Typical pipeline: Seedance chunk (silent or wrong audio) + sliced song WAV/MP3
 * → one MP4 with the video frames and the new audio track.
 *
 * Strategy:
 *   1. Try a fast remux (packet-copy video + packet-copy audio).
 *   2. On codec/container mismatch, normalize each side via Conversion
 *      (video-only MP4 + AAC audio-only MP4), then remux again.
 *
 * Output duration follows the video. Audio longer than the video is trimmed;
 * shorter audio ends early (silent tail for the rest of the video).
 *
 * Browser-only (mediabunny / WebCodecs).
 */

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

async function toVideoOnlyMp4(src: Blob | string): Promise<Blob> {
  const input = makeInput(src);
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      audio: { discard: true },
    });
    if (!conversion.isValid) {
      throw new Error("Could not strip audio from the video source.");
    }
    await conversion.execute();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("Video-only transcode produced no output.");
    return new Blob([buffer], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}

async function toAudioOnlyMp4(src: Blob | string): Promise<Blob> {
  const input = makeInput(src);
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      audio: { codec: "aac" },
    });
    if (!conversion.isValid) {
      throw new Error("Could not encode audio for muxing.");
    }
    await conversion.execute();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("Audio-only transcode produced no output.");
    return new Blob([buffer], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}

async function remuxReplaceAudio(
  videoSrc: Blob | string,
  audioSrc: Blob | string,
): Promise<Blob> {
  const videoInput = makeInput(videoSrc);
  const audioInput = makeInput(audioSrc);

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  try {
    const vTrack = await videoInput.getPrimaryVideoTrack();
    const aTrack = await audioInput.getPrimaryAudioTrack();
    if (!vTrack) throw new Error("Video source has no video track.");
    if (!aTrack) throw new Error("Audio source has no audio track.");

    const videoCodec = await vTrack.getCodec();
    if (!videoCodec) throw new Error("Unknown video codec.");
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    output.addVideoTrack(videoSource);
    const videoDecoderConfig = await vTrack.getDecoderConfig();

    const audioCodec = await aTrack.getCodec();
    if (!audioCodec) throw new Error("Unknown audio codec.");
    const audioSource = new EncodedAudioPacketSource(audioCodec);
    output.addAudioTrack(audioSource);
    const audioDecoderConfig = await aTrack.getDecoderConfig();

    await output.start();

    let videoEndSec = 0;
    let firstVideo = true;
    const vSink = new EncodedPacketSink(vTrack);
    for await (const packet of vSink.packets()) {
      const meta =
        firstVideo && videoDecoderConfig
          ? { decoderConfig: videoDecoderConfig }
          : undefined;
      firstVideo = false;
      await videoSource.add(packet, meta);
      videoEndSec = Math.max(videoEndSec, packet.timestamp + packet.duration);
    }

    let firstAudio = true;
    const aSink = new EncodedPacketSink(aTrack);
    for await (const packet of aSink.packets()) {
      if (packet.timestamp >= videoEndSec) break;
      const end = packet.timestamp + packet.duration;
      if (end > videoEndSec) {
        const trimmed = packet.clone({
          duration: Math.max(0, videoEndSec - packet.timestamp),
        });
        const meta =
          firstAudio && audioDecoderConfig
            ? { decoderConfig: audioDecoderConfig }
            : undefined;
        firstAudio = false;
        await audioSource.add(trimmed, meta);
        break;
      }
      const meta =
        firstAudio && audioDecoderConfig
          ? { decoderConfig: audioDecoderConfig }
          : undefined;
      firstAudio = false;
      await audioSource.add(packet, meta);
    }

    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("Mux produced no output buffer.");
    return new Blob([buffer], { type: "video/mp4" });
  } finally {
    videoInput.dispose();
    audioInput.dispose();
  }
}

export async function replaceVideoAudio(
  videoSrc: Blob | string,
  audioSrc: Blob | string,
): Promise<Blob> {
  try {
    return await remuxReplaceAudio(videoSrc, audioSrc);
  } catch {
    const [videoOnly, audioOnly] = await Promise.all([
      toVideoOnlyMp4(videoSrc),
      toAudioOnlyMp4(audioSrc),
    ]);
    return remuxReplaceAudio(videoOnly, audioOnly);
  }
}
