/**
 * Frame-sampling math — Slice 7.9.
 *
 * Pure (no mediabunny, no DOM) so it's unit-testable. Given a video
 * duration and a sampling spec, returns the ordered list of timestamps
 * (ms) at which to pull frames. Consumed by the Frames Extract node →
 * fed into the Image Grid for contact-sheet style layouts.
 *
 * Three modes:
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
 *   - "span":    N frames spanning the WHOLE clip, endpoint-inclusive —
 *                frame 1 sits at the very start (t=0) and frame N at the
 *                very end (`t = i/(N-1) · D`). The end is clamped 1ms
 *                inside the duration so `getSample`'s at-or-before lookup
 *                reliably lands on the final frame instead of skipping
 *                past it. Optional seeded `jitter` nudges the INTERIOR
 *                frames off the perfectly-even grid (endpoints stay
 *                pinned) so re-rolling the `seed` yields fresh, but
 *                reproducible, variations of the same N-frame span.
 *
 * Every mode is hard-capped by `maxFrames` so a long video at a tiny
 * interval can't try to decode thousands of frames (and overflow a
 * grid). The cap itself is clamped to a sane ceiling.
 */

export type FrameSamplingMode = "count" | "interval" | "span";

export interface FrameSamplingSpec {
  mode: FrameSamplingMode;
  /** modes "count" / "span": number of frames. Default 4. */
  count?: number;
  /** mode "interval": seconds between frames. Default 1. */
  intervalSec?: number;
  /** Hard cap on emitted frames. Default 64, clamped to [1, 256]. */
  maxFrames?: number;
  /**
   * mode "span": fraction [0, 1] of the inter-frame spacing by which each
   * interior frame may be nudged off the even grid. 0 = perfectly even.
   * 1 = up to ±half a spacing (frames stay ordered, never cross a
   * neighbour). Default 0.
   */
  jitter?: number;
  /** mode "span": integer seed for the jitter PRNG. Default 0. */
  seed?: number;
}

function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(value)));
}

/**
 * mulberry32 — tiny, fast, well-distributed 32-bit seeded PRNG. Pure and
 * deterministic so the same seed always yields the same jitter sequence
 * (the whole point of "give it a seed for reproducible variations").
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

  if (spec.mode === "span") {
    // Endpoint-inclusive: frame 0 at t=0, frame N-1 at the end (clamped
    // 1ms inside so the decoder lands on the final frame).
    const n = clampInt(spec.count ?? 4, 1, maxFrames);
    const maxT = Math.max(0, dur - 1);
    if (n === 1) return [0];
    const spacing = dur / (n - 1);
    const jitter = Number.isFinite(spec.jitter)
      ? Math.max(0, Math.min(1, spec.jitter!))
      : 0;
    const rand = mulberry32((spec.seed ?? 0) | 0);
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      let t = i * spacing;
      // Pin the endpoints so the span (start → end) is always preserved;
      // jitter only the interior frames. Advancing the PRNG solely for
      // interior frames keeps a given seed's sequence stable across N.
      if (jitter > 0 && i > 0 && i < n - 1) {
        t += (rand() - 0.5) * jitter * spacing;
      }
      times.push(Math.round(Math.max(0, Math.min(maxT, t))));
    }
    // Jitter can't make neighbours cross (max nudge is ±half a spacing),
    // but rounding/clamping at the ends could tie — sort defensively.
    times.sort((a, b) => a - b);
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
