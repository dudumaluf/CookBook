/**
 * Audio/video windowing math — Slice A (multimodal media arc).
 *
 * Pure, framework-free, fully unit-testable. The Audio Slice node + the
 * Continuity Builder use this to split a track into sequential windows
 * aligned to a per-call duration cap (Seedance: 15s max per generation).
 *
 * Kept separate from the WebCodecs-backed media ops (which can only run in a
 * real browser) so the windowing logic — the part that actually drives the
 * chunk count + timing of a 4-minute song — is testable without WebCodecs.
 */

export interface MediaWindow {
  /** 0-based window index. */
  index: number;
  /** Inclusive start, milliseconds. */
  startMs: number;
  /** Exclusive end, milliseconds. */
  endMs: number;
  /** Convenience: `endMs - startMs`. */
  durationMs: number;
}

export interface ComputeWindowsOptions {
  /** Total media duration in milliseconds. Must be > 0. */
  totalMs: number;
  /** Target window length in milliseconds (e.g. 15000 for Seedance). */
  windowMs: number;
  /**
   * If the final window would be shorter than this, fold it into the
   * previous window instead of emitting a tiny tail clip. Default 0 (always
   * emit the tail as its own window). A sensible value for Seedance is ~2000
   * (its minimum accepted clip is ~2s).
   */
  minTailMs?: number;
}

/**
 * Split `[0, totalMs)` into sequential, non-overlapping windows of at most
 * `windowMs` each. The last window carries the remainder.
 *
 * Examples (windowMs = 15000):
 *   totalMs 45000           -> 3 windows: [0,15000) [15000,30000) [30000,45000)
 *   totalMs 40000           -> 3 windows, last is [30000,40000) (10s)
 *   totalMs 31000, minTail 2000 -> 2 windows, last folds the 1s tail: [15000,31000)
 */
export function computeMediaWindows(
  options: ComputeWindowsOptions,
): MediaWindow[] {
  const { totalMs, windowMs, minTailMs = 0 } = options;
  if (!Number.isFinite(totalMs) || totalMs <= 0) return [];
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("windowMs must be a positive number");
  }

  const windows: MediaWindow[] = [];
  let start = 0;
  let index = 0;
  while (start < totalMs) {
    const end = Math.min(start + windowMs, totalMs);
    windows.push({
      index,
      startMs: start,
      endMs: end,
      durationMs: end - start,
    });
    start = end;
    index += 1;
  }

  // Fold a too-short tail into the previous window.
  if (minTailMs > 0 && windows.length >= 2) {
    const last = windows[windows.length - 1]!;
    if (last.durationMs < minTailMs) {
      const prev = windows[windows.length - 2]!;
      prev.endMs = last.endMs;
      prev.durationMs = prev.endMs - prev.startMs;
      windows.pop();
    }
  }

  return windows;
}

/**
 * How many windows a track of `totalMs` produces at `windowMs` (with optional
 * tail-fold). Handy for cost estimation before running anything (each window
 * is one paid generation).
 */
export function countMediaWindows(options: ComputeWindowsOptions): number {
  return computeMediaWindows(options).length;
}
