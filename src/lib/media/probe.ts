/**
 * Media probing via mediabunny — Slice A (multimodal media arc).
 *
 * Reads duration + dimensions from a video/audio file WITHOUT decoding frames
 * (pure demuxing of metadata), so it is the cheapest mediabunny operation and
 * the safest to ship first. Client-only: mediabunny relies on browser APIs
 * (Blob/fetch) and is excluded from the Node build.
 *
 * Frame extraction, slicing, concat, and normalization (the WebCodecs-heavy
 * ops) land in Slice D alongside the nodes that consume them, where they can
 * be smoke-tested in a real browser. Their contracts are declared in
 * `index.ts`.
 */

import { ALL_FORMATS, BlobSource, Input, UrlSource } from "mediabunny";

export interface MediaProbeResult {
  durationMs: number;
  /** CODED dimensions — the raw decoded buffer, BEFORE rotation / pixel-aspect. */
  width?: number;
  height?: number;
  /**
   * DISPLAY dimensions — after rotation + pixel-aspect adjustment, i.e. what a
   * player actually shows. For a rotated phone clip these are swapped vs.
   * coded (e.g. coded 1920×1080 → display 1080×1920). Use these whenever a
   * pixel coordinate must line up with the visible frame (e.g. mapping marks
   * drawn on a `extractFrame` thumbnail). Falls back to coded for callers that
   * predate this field.
   */
  displayWidth?: number;
  displayHeight?: number;
  mimeType?: string;
  hasVideo: boolean;
  hasAudio: boolean;
}

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

/**
 * Probe a media file (Blob or URL) for duration, dimensions, and track
 * presence. Returns durationMs rounded to the nearest ms.
 */
export async function probeMedia(
  src: Blob | string,
): Promise<MediaProbeResult> {
  const input = makeInput(src);
  try {
    const [durationSec, videoTrack, audioTrack, mimeType] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
      input.getMimeType().catch(() => undefined),
    ]);

    let width: number | undefined;
    let height: number | undefined;
    let displayWidth: number | undefined;
    let displayHeight: number | undefined;
    if (videoTrack) {
      [width, height, displayWidth, displayHeight] = await Promise.all([
        videoTrack.getCodedWidth(),
        videoTrack.getCodedHeight(),
        videoTrack.getDisplayWidth(),
        videoTrack.getDisplayHeight(),
      ]);
    }

    return {
      durationMs: Math.round(durationSec * 1000),
      width,
      height,
      displayWidth,
      displayHeight,
      mimeType,
      hasVideo: videoTrack !== null,
      hasAudio: audioTrack !== null,
    };
  } finally {
    input.dispose();
  }
}
