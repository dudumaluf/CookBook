/**
 * Selection-mode helper for iterator nodes (ADR-0031).
 *
 * The vocabulary is shared between every iteration source in the graph
 * (Image Iterator, Text Iterator — and, in Slice 5.6+, the Number node):
 *
 *   - `fixed`     — emit just `items[cursor]`. Cursor is not advanced.
 *   - `increment` — emit `items[cursor]`, then advance cursor by +1.
 *   - `decrement` — emit `items[cursor]`, then advance cursor by -1.
 *   - `random`    — emit one item at a randomly-picked index. Cursor is
 *                   updated to that index so the body's preview matches.
 *   - `range`     — emit `items[start..end]` (inclusive, normalized).
 *                   Cursor not advanced — `range` is "this is the slice
 *                   I want every run", not "step through".
 *   - `all`       — emit every item. Cursor not advanced.
 *
 * Pure: no IO, no store reads. The caller (an iterator node's `execute()`)
 * is responsible for persisting `nextCursor` back into its config when
 * `mode === "increment" | "decrement" | "random"` so the next run picks
 * up where this one left off.
 *
 * The cursor wraps modularly so `increment` past the end loops back to 0
 * (and likewise `decrement` past 0 loops to N-1) — matches the ComfyUI
 * "incremental seed" mental model the user referenced when we designed
 * this in ADR-0031.
 */

export const SELECTION_MODES = [
  "fixed",
  "increment",
  "decrement",
  "random",
  "range",
  "all",
] as const;

export type SelectionMode = (typeof SELECTION_MODES)[number];

export function isSelectionMode(value: unknown): value is SelectionMode {
  return (
    typeof value === "string" &&
    (SELECTION_MODES as readonly string[]).includes(value)
  );
}

/**
 * Optional `range` input. Both indices are inclusive and 0-indexed; the
 * helper normalizes out-of-bound / inverted ranges so the caller doesn't
 * have to validate.
 */
export interface SelectionRange {
  start: number;
  end: number;
}

export interface ApplySelectionModeInput<T> {
  items: readonly T[];
  mode: SelectionMode;
  cursor: number;
  range?: SelectionRange;
  /**
   * Injectable RNG so tests are deterministic. Defaults to Math.random.
   * Returns a float in `[0, 1)`.
   */
  random?: () => number;
}

export interface ApplySelectionModeResult<T> {
  /** The items the iterator should emit this run. */
  items: T[];
  /**
   * The cursor the iterator should persist for the next run. For modes
   * that don't advance (`fixed`, `range`, `all`), this is the same value
   * passed in. For `random`, this is the index that was actually picked
   * (so the body's preview matches the next run's emission).
   */
  nextCursor: number;
}

/**
 * Apply the selection mode and return what the iterator should emit
 * plus what the cursor should be after this run.
 *
 * Semantics edge cases:
 *   - empty `items` → returns `{ items: [], nextCursor: 0 }` for every mode.
 *   - cursor out of range → clamped to `[0, items.length - 1]` before use.
 *   - `range` with `start > end` → swapped silently.
 *   - `range` indices outside `[0, items.length)` → clamped.
 *   - `random` on a 1-item list → still returns that 1 item; nextCursor
 *     is 0 (deterministic on a 1-item list regardless of the RNG).
 */
export function applySelectionMode<T>(
  input: ApplySelectionModeInput<T>,
): ApplySelectionModeResult<T> {
  const { items, mode, range } = input;
  const random = input.random ?? Math.random;
  const n = items.length;
  if (n === 0) return { items: [], nextCursor: 0 };

  // Clamp and normalize cursor up-front so every branch can rely on it
  // being in `[0, n - 1]`.
  const cursor = clampInt(input.cursor, 0, n - 1);

  switch (mode) {
    case "fixed":
      return { items: [items[cursor]!], nextCursor: cursor };

    case "increment": {
      const next = (cursor + 1) % n;
      return { items: [items[cursor]!], nextCursor: next };
    }

    case "decrement": {
      // `% n` with a negative numerator returns a negative remainder in
      // JS; explicit branch keeps the wrap predictable.
      const next = cursor === 0 ? n - 1 : cursor - 1;
      return { items: [items[cursor]!], nextCursor: next };
    }

    case "random": {
      // 1-item list short-circuits to deterministic 0 — saves a roll
      // and stays predictable in the body preview.
      if (n === 1) return { items: [items[0]!], nextCursor: 0 };
      const pick = Math.floor(random() * n);
      // Defensive against an RNG that returns 1.0 (Math.random can't,
      // but injected RNGs in tests might).
      const safePick = pick >= n ? n - 1 : pick;
      return { items: [items[safePick]!], nextCursor: safePick };
    }

    case "range": {
      if (!range) {
        // No range provided → behave like `all` (the body should never
        // submit `range` without start/end, but we don't crash if it does).
        return { items: [...items], nextCursor: cursor };
      }
      const a = clampInt(range.start, 0, n - 1);
      const b = clampInt(range.end, 0, n - 1);
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      return {
        items: items.slice(start, end + 1),
        nextCursor: cursor,
      };
    }

    case "all":
      return { items: [...items], nextCursor: cursor };
  }
}

function clampInt(value: number, min: number, max: number): number {
  // `Number.isFinite` excludes NaN / Infinity / non-numbers (TS allows
  // unknown to slip through if a persisted cursor is malformed).
  if (!Number.isFinite(value)) return min;
  const rounded = Math.trunc(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}
