/**
 * Frame-sampling math — Slice 7.9.
 *
 * Pure (no mediabunny, no DOM) so it's unit-testable. Given a video
 * duration and a sampling spec, returns the ordered list of timestamps
 * (ms) at which to pull frames. Consumed by the Frames Extract node →
 * fed into the Image Grid for contact-sheet style layouts.
 *
 * Two modes:
 *
 *   - "count":   N evenly-spaced frames. We sample at the CENTRE of N
 *                equal time segments (`(i + 0.5)/N · D`) rather than at
 *                the endpoints. This dodges the two classic failure
 *                modes of endpoint sampling: a black/fade-in first
 *                frame at t=0 and a past-the-end last frame at t=D
 *                (which the decoder can't land on). Each frame is a
 *                representative thumbnail of its slice — exactly what a
 *                grid wants.
 *
 *   - "interval": one frame every `intervalSec` seconds, starting at
 *                t=0, up to the duration. Intuitive ("grab a frame
 *                every 2s"); the count falls out of the duration.
 *
 * Both modes are hard-capped by `maxFrames` so a long video at a tiny
 * interval can't try to decode thousands of frames (and overflow a
 * grid). The cap itself is clamped to a sane ceiling.
 */

export type FrameSamplingMode = "count" | "interval";

export interface FrameSamplingSpec {
  mode: FrameSamplingMode;
  /** mode "count": number of evenly-spaced frames. Default 4. */
  count?: number;
  /** mode "interval": seconds between frames. Default 1. */
  intervalSec?: number;
  /** Hard cap on emitted frames. Default 64, clamped to [1, 256]. */
  maxFrames?: number;
}

function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(value)));
}

/**
 * Compute the ordered timestamps (ms) to sample for a given duration +
 * spec. Always returns at least one timestamp (`[0]`) so callers never
 * have to special-case an empty result. Degenerate durations
 * (zero / NaN / negative) collapse to a single frame at t=0.
 */
export function frameTimestampsMs(
  durationMs: number,
  spec: FrameSamplingSpec,
): number[] {
  const maxFrames = clampInt(spec.maxFrames ?? 64, 1, 256);
  const dur =
    Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 0;
  if (dur <= 0) return [0];

  if (spec.mode === "interval") {
    const intervalMs = Math.max(
      1,
      Math.round((spec.intervalSec ?? 1) * 1000),
    );
    const times: number[] = [];
    for (let t = 0; t < dur && times.length < maxFrames; t += intervalMs) {
      times.push(Math.round(t));
    }
    if (times.length === 0) times.push(0);
    return times;
  }

  // "count" — segment-centre sampling.
  const n = clampInt(spec.count ?? 4, 1, maxFrames);
  if (n === 1) return [Math.round(dur / 2)];
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    times.push(Math.round(((i + 0.5) / n) * dur));
  }
  return times;
}
