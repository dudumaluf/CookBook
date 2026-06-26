/**
 * Media toolkit (mediabunny-backed) — Slice A foundation.
 *
 * Cookbook's client-side media layer. mediabunny (a zero-dependency
 * WebCodecs toolkit, "FFmpeg for the web") runs entirely in the browser, so
 * no server ffmpeg/media infra is needed. See docs/DECISIONS.md ADR for the
 * media layer.
 *
 * What ships in Slice A (here, now):
 *   - `computeMediaWindows` / `countMediaWindows` (windows.ts) — pure
 *     windowing math used by Audio Slice + the Continuity Builder.
 *   - Seedance constraint helpers (constraints.ts) — pure validation.
 *   - `probeMedia` (probe.ts) — metadata read (duration, dimensions, tracks)
 *     via mediabunny demuxing (no WebCodecs decode).
 *
 * What ships in Slice C (the WebCodecs ops, browser-smoke-tested):
 *   - `extractFrame(src, "first" | "last" | { atMs })` => PNG Blob —
 *     VideoSampleSink + canvas; the frame-chain continuity strategy.
 *   - `sliceAudio(src, windows)` => WAV Blob[] — Conversion API trim;
 *     feeds per-chunk @Audio1 to Seedance.
 *
 * Slice D.2:
 *   - `concatVideos(clips)` => MP4 Blob — remux (packet-copy) join of the
 *     chunk array into one continuous video.
 *   - `replaceVideoAudio(video, audio)` => MP4 Blob — mux video frames with a
 *     replacement audio track (remux when possible, transcode fallback).
 *   - `audioToSilentVideo(audio)` => MP4 Blob — render a song as a solid-black
 *     video carrying the audio track (ByteDance audio-as-@Video1 reference).
 *
 * Still deferred (only when a real pipeline needs it):
 *   - `normalizeMedia(src, target)` — Conversion API transcode/resize to fit
 *     Seedance's resolution/size/format limits.
 */

export {
  computeMediaWindows,
  countMediaWindows,
  type ComputeWindowsOptions,
  type MediaWindow,
} from "./windows";

export {
  SEEDANCE,
  SEEDANCE_ASPECT_RATIOS,
  type SeedanceAspectRatio,
  type ConstraintViolation,
  validateSeedanceRequest,
  clampSeedanceDuration,
} from "./constraints";

export { probeMedia, type MediaProbeResult } from "./probe";

export { extractFrame, extractFrames, type FramePosition } from "./extract-frame";

export {
  frameTimestampsMs,
  type FrameSamplingMode,
  type FrameSamplingSpec,
} from "./frame-timestamps";

export { sliceAudio } from "./slice-audio";

export { sliceVideo } from "./slice-video";

export { concatVideos } from "./concat";

export { replaceVideoAudio } from "./replace-audio";

export {
  audioToSilentVideo,
  silentVideoDimensions,
  type AudioToSilentVideoOptions,
  type SilentVideoAspectRatio,
} from "./audio-to-video";

export {
  padVideoToMinDuration,
  splitPadDuration,
  type PadMode,
  type PadVideoOptions,
  type PadVideoResult,
  type PadVideoSplit,
} from "./pad-video";

export {
  bboxFromMaskData,
  buildTrack,
  centerAt,
  computeMaskTrack,
  movingAverage,
  OBJECT_TRACK_DEFAULTS,
  type BuildTrackOptions,
  type NormBox,
  type ObjectTrack,
  type TrackCenter,
} from "./object-track";

export { cropVideoToTrack, type CropVideoResult } from "./track-crop";

export {
  recomposeVideoFromTrack,
  type RecomposeVideoResult,
} from "./track-recompose";

export {
  resolveResize,
  resizeImage,
  resizeVideo,
  type ResizeMode,
  type ResizeGeometry,
  type ResizeImageOptions,
  type ResizeVideoOptions,
} from "./resize";

export { fetchMediaBlob, loadBitmap, proxiedMediaUrl } from "./load-bitmap";
