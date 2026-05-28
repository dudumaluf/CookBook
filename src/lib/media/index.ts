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
 * What lands in Slice D (the WebCodecs-heavy ops, alongside the nodes that
 * consume them, browser-smoke-tested):
 *   - `extractFrame(src, { atMs | "first" | "last" }) => Promise<Blob>` —
 *     VideoSampleSink + VideoSample.toCanvas; the frame-chain continuity
 *     strategy depends on this.
 *   - `sliceAudio(src, windows) => Promise<Blob[]>` — Conversion API with
 *     per-window trim; feeds per-chunk @Audio1 to Seedance.
 *   - `concatVideos(clips) => Promise<Blob>` — Output + multiple sources;
 *     stitches the chunk array into one continuous video.
 *   - `normalizeMedia(src, target) => Promise<Blob>` — Conversion API
 *     transcode/resize to fit Seedance's resolution/size/format limits.
 *
 * These are declared here as the contract so Slice D fills in the bodies
 * without re-deciding the surface.
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
