import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  Conversion,
  Input,
  Mp3OutputFormat,
  Output,
  type OutputFormat,
  UrlSource,
  WavOutputFormat,
} from "mediabunny";

import type { MediaWindow } from "./windows";

/**
 * Audio slicing via mediabunny — Slice C (multimodal media arc).
 *
 * Trims an audio track into one Blob per window. The performance pipeline
 * splits a 4-minute song into 15s windows (see `computeMediaWindows`) and
 * feeds each window as the `@Audio1` reference for its Seedance chunk, so
 * lip-sync follows the real song across the whole video.
 *
 * Output format (both accepted by Seedance):
 *   - "wav" (default) — lossless, no encoder needed (raw PCM), bigger files.
 *   - "mp3" — far smaller; needs the LAME encoder (lazy-loaded + registered
 *     on first use via `@mediabunny/mp3-encoder`, unless the browser can
 *     already encode MP3 natively).
 *
 * Browser-only (WebCodecs via mediabunny). One Input per window — Conversion
 * consumes the input, and per-window inputs keep the trims independent +
 * cancel-safe. `video: { discard: true }` means a VIDEO source yields just
 * its audio track.
 */

export type AudioSliceFormat = "wav" | "mp3";

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

// Register the WASM LAME encoder once, only when MP3 is actually requested
// and the browser can't already encode MP3 natively.
let mp3EncoderReady: Promise<void> | null = null;
function ensureMp3Encoder(): Promise<void> {
  if (!mp3EncoderReady) {
    mp3EncoderReady = (async () => {
      if (!(await canEncodeAudio("mp3"))) {
        const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
        registerMp3Encoder();
      }
    })();
  }
  return mp3EncoderReady;
}

export interface SliceAudioOptions {
  /** Output container/codec. Default "wav". */
  format?: AudioSliceFormat;
}

export async function sliceAudio(
  src: Blob | string,
  windows: readonly MediaWindow[],
  opts: SliceAudioOptions = {},
): Promise<Blob[]> {
  const format = opts.format ?? "wav";
  if (format === "mp3") await ensureMp3Encoder();
  const mime = format === "mp3" ? "audio/mpeg" : "audio/wav";
  const makeFormat = (): OutputFormat =>
    format === "mp3" ? new Mp3OutputFormat() : new WavOutputFormat();

  const slices: Blob[] = [];
  for (const window of windows) {
    const input = makeInput(src);
    const output = new Output({
      format: makeFormat(),
      target: new BufferTarget(),
    });
    try {
      const conversion = await Conversion.init({
        input,
        output,
        trim: { start: window.startMs / 1000, end: window.endMs / 1000 },
        // Audio-only output — drop any video track in the source.
        video: { discard: true },
      });
      await conversion.execute();
      const buffer = (output.target as BufferTarget).buffer;
      if (!buffer) {
        throw new Error(
          `Audio slice ${window.index} produced no output buffer.`,
        );
      }
      slices.push(new Blob([buffer], { type: mime }));
    } finally {
      input.dispose();
    }
  }
  return slices;
}
