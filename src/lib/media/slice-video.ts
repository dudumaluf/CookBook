import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  UrlSource,
} from "mediabunny";

import type { MediaWindow } from "./windows";

/**
 * Video slicing via mediabunny (singer-performance pipeline).
 *
 * Trims a video into one MP4 Blob per window — the visual counterpart of
 * `sliceAudio`. The performance pipeline slices a reference performance
 * video into the SAME 15s windows as the song, then feeds each window as
 * the `@Video1` motion reference for its Seedance chunk, so the generated
 * character mirrors the original performance across the whole video.
 *
 * Audio is discarded: the slice is a *motion* reference; the song audio is
 * supplied separately (`@Audio1`) for lip-sync. Dropping audio also keeps
 * each chunk well under Seedance's per-reference size budget. Browser-only
 * (WebCodecs via mediabunny). One Input per window keeps trims independent
 * + cancel-safe (mirrors `sliceAudio`).
 */

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

export interface SliceVideoOptions {
  /**
   * Cap the output height (px), preserving aspect ratio (width auto-scales).
   * Seedance reference videos must be <= ~720p, so callers pass 720 (or 480
   * for a smaller/cheaper reference). Omit to keep the source resolution.
   */
  maxHeight?: number;
}

export async function sliceVideo(
  src: Blob | string,
  windows: readonly MediaWindow[],
  opts: SliceVideoOptions = {},
): Promise<Blob[]> {
  const slices: Blob[] = [];
  for (const window of windows) {
    const input = makeInput(src);
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });
    try {
      const conversion = await Conversion.init({
        input,
        output,
        trim: { start: window.startMs / 1000, end: window.endMs / 1000 },
        // Motion reference only — the song audio is fed separately.
        audio: { discard: true },
        // Downscale to fit Seedance's reference cap (~720p). Setting only
        // height preserves the source aspect ratio (width auto-scales).
        ...(opts.maxHeight ? { video: { height: opts.maxHeight } } : {}),
      });
      await conversion.execute();
      const buffer = (output.target as BufferTarget).buffer;
      if (!buffer) {
        throw new Error(
          `Video slice ${window.index} produced no output buffer.`,
        );
      }
      slices.push(new Blob([buffer], { type: "video/mp4" }));
    } finally {
      input.dispose();
    }
  }
  return slices;
}
