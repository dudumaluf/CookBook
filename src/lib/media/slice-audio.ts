import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Output,
  UrlSource,
  WavOutputFormat,
} from "mediabunny";

import type { MediaWindow } from "./windows";

/**
 * Audio slicing via mediabunny — Slice C (multimodal media arc).
 *
 * Trims an audio track into one WAV Blob per window. The performance
 * pipeline splits a 4-minute song into 15s windows (see `computeMediaWindows`)
 * and feeds each window as the `@Audio1` reference for its Seedance chunk,
 * so lip-sync follows the real song across the whole video.
 *
 * WAV output: lossless, simple, and accepted by Seedance. Browser-only
 * (WebCodecs via mediabunny). One Input per window — Conversion consumes the
 * input, and per-window inputs keep the trims independent + cancel-safe.
 */

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

export async function sliceAudio(
  src: Blob | string,
  windows: readonly MediaWindow[],
): Promise<Blob[]> {
  const slices: Blob[] = [];
  for (const window of windows) {
    const input = makeInput(src);
    const output = new Output({
      format: new WavOutputFormat(),
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
      slices.push(new Blob([buffer], { type: "audio/wav" }));
    } finally {
      input.dispose();
    }
  }
  return slices;
}
