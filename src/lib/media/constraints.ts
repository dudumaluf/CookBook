/**
 * Seedance 2.0 media constraints — Slice A (multimodal media arc).
 *
 * Pure helpers encoding the limits the Fal `bytedance/seedance-2.0/*`
 * endpoints enforce (see docs/FAL-CATALOG.md). The Continuity Builder + the
 * Video Gen node consult these BEFORE spending money, so a too-long clip or
 * an out-of-range resolution is caught client-side with a clear message
 * instead of a wasted upstream 400.
 *
 * Source of truth: Fal docs (confirmed 2026-05-28). Update here when the
 * model's limits change.
 */

export const SEEDANCE = {
  /** Per-generation duration bounds, seconds. */
  minDurationSec: 4,
  maxDurationSec: 15,
  /** Reference input caps. */
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  /** Total reference files across all modalities. */
  maxTotalRefs: 12,
  /** Combined reference-video duration bounds, seconds. */
  refVideoMinTotalSec: 2,
  refVideoMaxTotalSec: 15,
  /** Combined reference-audio duration cap, seconds. */
  refAudioMaxTotalSec: 15,
  /** Reference-video resolution bounds (square-equivalent edges). */
  refVideoMinEdge: 480,
  refVideoMaxEdge: 720,
  /** Size caps, bytes. */
  maxImageBytes: 30 * 1024 * 1024,
  maxRefVideoTotalBytes: 50 * 1024 * 1024,
  maxAudioBytesEach: 15 * 1024 * 1024,
} as const;

export type SeedanceAspectRatio =
  | "16:9"
  | "9:16"
  | "1:1"
  | "21:9"
  | "auto";

export const SEEDANCE_ASPECT_RATIOS: readonly SeedanceAspectRatio[] = [
  "auto",
  "16:9",
  "9:16",
  "1:1",
  "21:9",
];

export interface ConstraintViolation {
  field: string;
  message: string;
}

/**
 * Validate a planned Seedance generation against the documented limits.
 * Returns an array of violations (empty = OK). Pure — no network.
 */
export function validateSeedanceRequest(args: {
  durationSec?: number;
  imageCount?: number;
  videoCount?: number;
  audioCount?: number;
}): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const {
    durationSec,
    imageCount = 0,
    videoCount = 0,
    audioCount = 0,
  } = args;

  if (durationSec !== undefined) {
    if (
      durationSec < SEEDANCE.minDurationSec ||
      durationSec > SEEDANCE.maxDurationSec
    ) {
      violations.push({
        field: "duration",
        message: `Duration must be ${SEEDANCE.minDurationSec}-${SEEDANCE.maxDurationSec}s (got ${durationSec}s).`,
      });
    }
  }
  if (imageCount > SEEDANCE.maxImages) {
    violations.push({
      field: "images",
      message: `At most ${SEEDANCE.maxImages} reference images (got ${imageCount}).`,
    });
  }
  if (videoCount > SEEDANCE.maxVideos) {
    violations.push({
      field: "videos",
      message: `At most ${SEEDANCE.maxVideos} reference videos (got ${videoCount}).`,
    });
  }
  if (audioCount > SEEDANCE.maxAudios) {
    violations.push({
      field: "audios",
      message: `At most ${SEEDANCE.maxAudios} reference audio clips (got ${audioCount}).`,
    });
  }
  const total = imageCount + videoCount + audioCount;
  if (total > SEEDANCE.maxTotalRefs) {
    violations.push({
      field: "total",
      message: `At most ${SEEDANCE.maxTotalRefs} reference files across all modalities (got ${total}).`,
    });
  }
  // Audio-with-no-visual rule: if audio is provided, at least one image or
  // video reference is required.
  if (audioCount > 0 && imageCount === 0 && videoCount === 0) {
    violations.push({
      field: "audios",
      message:
        "Reference audio requires at least one reference image or video.",
    });
  }
  return violations;
}

/**
 * Clamp a desired clip length to Seedance's accepted range. Used when the
 * Continuity Builder derives per-chunk duration from audio windows that might
 * exceed 15s (they shouldn't if windowed correctly, but belt-and-suspenders).
 */
export function clampSeedanceDuration(sec: number): number {
  return Math.min(
    SEEDANCE.maxDurationSec,
    Math.max(SEEDANCE.minDurationSec, Math.round(sec)),
  );
}
