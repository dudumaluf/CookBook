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
import {
  type BuildTrackOptions,
  centerAt,
  computeMaskTrack,
  OBJECT_TRACK_DEFAULTS,
} from "./object-track";

/**
 * Track Recompose — paste an edited crop back into the original footage,
 * the inverse of Object Track Crop.
 *
 * It recomputes the SAME tracked windows from the SAME mask (shared
 * `computeMaskTrack` + fixed defaults), so the geometry matches the crop by
 * construction — there's no transform side-channel to keep in sync. The
 * original frame is the base; for each frame the edited crop is scaled into
 * the tracked window, then keyed through the mask (luma → alpha) so only the
 * masked object replaces the original — background and everything outside
 * the window stay untouched.
 *
 * The original timeline drives the output; the edited clip is sampled at the
 * matching normalised time so a re-timed edit still lands frame-for-frame.
 * Audio is dropped — re-attach the original track with Video Audio Merge.
 *
 * Browser-only (WebCodecs); mocked at the node-test layer.
 */

function makeInput(src: Blob | string): Input {
  const source =
    typeof src === "string" ? new UrlSource(src) : new BlobSource(src);
  return new Input({ formats: ALL_FORMATS, source });
}

function evenDim(n: number): number {
  const r = Math.max(2, Math.round(n));
  return r % 2 === 0 ? r : r + 1;
}

export interface RecomposeVideoResult {
  blob: Blob;
  width: number;
  height: number;
  durationMs: number;
}

export async function recomposeVideoFromTrack(
  originalSrc: Blob | string,
  editedSrc: Blob | string,
  maskSrc: Blob | string,
  opts: BuildTrackOptions = {},
): Promise<RecomposeVideoResult> {
  const track = await computeMaskTrack(maskSrc, opts);
  // Matte key: a soft step around the same luma threshold the tracker used.
  // Binary-ish rather than raw luma so it works whether the SAM output is a
  // white matte or an object-on-black cutout (dark object pixels would key out
  // as transparent under raw luma). `FEATHER` is the soft-edge band width.
  const threshold = opts.threshold ?? OBJECT_TRACK_DEFAULTS.threshold;
  const FEATHER = 0.08;

  const origInput = makeInput(originalSrc);
  const editedInput = makeInput(editedSrc);
  const maskInput = makeInput(maskSrc);
  try {
    const origTrack = await origInput.getPrimaryVideoTrack();
    if (!origTrack) throw new Error("No original video track to recompose.");
    const editedTrack = await editedInput.getPrimaryVideoTrack();
    if (!editedTrack) throw new Error("No edited video track to recompose.");
    const maskTrack = await maskInput.getPrimaryVideoTrack();
    if (!maskTrack) throw new Error("No mask video track to recompose.");

    const origSink = new VideoSampleSink(origTrack);
    const editedSink = new VideoSampleSink(editedTrack);
    const maskSink = new VideoSampleSink(maskTrack);

    const origDur = await origInput.computeDuration([origTrack]);
    const editedDur = await editedInput.computeDuration([editedTrack]);

    // Mask dimensions (one decode) for the matte sampling.
    const maskProbe = await maskSink.getSample(
      await maskInput.getFirstTimestamp([maskTrack]),
    );
    if (!maskProbe) throw new Error("Could not decode the mask for recompose.");
    const maskW = maskProbe.displayWidth;
    const maskH = maskProbe.displayHeight;
    maskProbe.close();
    const maskFull = new OffscreenCanvas(maskW, maskH);
    const maskFullCtx = maskFull.getContext("2d", { willReadFrequently: true });
    if (!maskFullCtx) throw new Error("Could not acquire a mask 2D context.");

    let canvas: OffscreenCanvas | null = null;
    let ctx: OffscreenCanvasRenderingContext2D | null = null;
    let output: Output | null = null;
    let videoSource: CanvasSource | null = null;
    let cw = 0;
    let ch = 0;
    let lastEndSec = 0;

    // Reusable object + matte canvases (resized per frame as the window moves).
    const objCanvas = new OffscreenCanvas(2, 2);
    const objCtx = objCanvas.getContext("2d", { willReadFrequently: true });
    const matteCanvas = new OffscreenCanvas(2, 2);
    const matteCtx = matteCanvas.getContext("2d", { willReadFrequently: true });
    if (!objCtx || !matteCtx) {
      throw new Error("Could not acquire compositing 2D contexts.");
    }

    for await (const origSample of origSink.samples()) {
      const t = origSample.timestamp;
      if (!canvas) {
        cw = evenDim(origSample.displayWidth);
        ch = evenDim(origSample.displayHeight);
        canvas = new OffscreenCanvas(cw, ch);
        ctx = canvas.getContext("2d");
        if (!ctx) {
          origSample.close();
          throw new Error("Could not acquire a 2D context for recompose.");
        }
        output = new Output({
          format: new Mp4OutputFormat(),
          target: new BufferTarget(),
        });
        videoSource = new CanvasSource(canvas, {
          codec: "avc",
          bitrate: QUALITY_HIGH,
        });
        output.addVideoTrack(videoSource);
        await output.start();
      }

      // Base layer: the untouched original frame.
      origSample.draw(ctx!, 0, 0, cw, ch);

      const c = centerAt(track, t);
      const winWpx = track.size.w * cw;
      const winHpx = track.size.h * ch;
      const winXpx = (c.cx - track.size.w / 2) * cw;
      const winYpx = (c.cy - track.size.h / 2) * ch;
      const tmpW = Math.max(2, Math.round(winWpx));
      const tmpH = Math.max(2, Math.round(winHpx));

      const editedTime =
        origDur > 0 ? (t / origDur) * editedDur : Math.min(t, editedDur);
      const editedSample = await editedSink.getSample(editedTime);
      const maskSample = await maskSink.getSample(t);

      if (editedSample && maskSample) {
        if (objCanvas.width !== tmpW || objCanvas.height !== tmpH) {
          objCanvas.width = tmpW;
          objCanvas.height = tmpH;
          matteCanvas.width = tmpW;
          matteCanvas.height = tmpH;
        }
        // Edited crop scaled into the window.
        objCtx.globalCompositeOperation = "source-over";
        objCtx.clearRect(0, 0, tmpW, tmpH);
        editedSample.draw(objCtx, 0, 0, tmpW, tmpH);

        // Mask window → alpha matte. Draw the whole mask shifted/scaled so the
        // window region fills the matte canvas; outside the frame stays clear
        // (alpha 0), matching the crop's black-fill.
        maskFullCtx.clearRect(0, 0, maskW, maskH);
        maskSample.draw(maskFullCtx, 0, 0, maskW, maskH);
        const msrcX = (c.cx - track.size.w / 2) * maskW;
        const msrcY = (c.cy - track.size.h / 2) * maskH;
        const msrcW = track.size.w * maskW;
        const msrcH = track.size.h * maskH;
        const scaleX = tmpW / msrcW;
        const scaleY = tmpH / msrcH;
        matteCtx.clearRect(0, 0, tmpW, tmpH);
        matteCtx.drawImage(
          maskFull,
          -msrcX * scaleX,
          -msrcY * scaleY,
          maskW * scaleX,
          maskH * scaleY,
        );
        // Convert luma → alpha so the white mask becomes the keep-region.
        const matte = matteCtx.getImageData(0, 0, tmpW, tmpH);
        const md = matte.data;
        for (let i = 0; i < md.length; i += 4) {
          const luma =
            (0.299 * md[i]! + 0.587 * md[i + 1]! + 0.114 * md[i + 2]!) / 255;
          const a = Math.max(0, Math.min(1, (luma - threshold) / FEATHER));
          md[i] = 255;
          md[i + 1] = 255;
          md[i + 2] = 255;
          md[i + 3] = Math.round(a * 255);
        }
        matteCtx.putImageData(matte, 0, 0);

        // Key the edited crop by the matte, then paste into place.
        objCtx.globalCompositeOperation = "destination-in";
        objCtx.drawImage(matteCanvas, 0, 0);
        objCtx.globalCompositeOperation = "source-over";
        ctx!.drawImage(objCanvas, winXpx, winYpx);
      }

      editedSample?.close();
      maskSample?.close();

      const dur = origSample.duration > 0 ? origSample.duration : 1 / 30;
      await videoSource!.add(t, dur);
      lastEndSec = Math.max(lastEndSec, t + dur);
      origSample.close();
    }

    if (!output || !videoSource) {
      throw new Error("Could not decode any original frame to recompose.");
    }

    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("Recompose produced no output buffer.");

    return {
      blob: new Blob([buffer], { type: "video/mp4" }),
      width: cw,
      height: ch,
      durationMs: Math.round(lastEndSec * 1000),
    };
  } finally {
    origInput.dispose();
    editedInput.dispose();
    maskInput.dispose();
  }
}
