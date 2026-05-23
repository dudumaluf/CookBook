import { describe, expect, it } from "vitest";

import {
  SELECTION_MODES,
  applySelectionMode,
  isSelectionMode,
} from "@/lib/iterators/selection-mode";

describe("isSelectionMode", () => {
  it("accepts every defined mode", () => {
    for (const mode of SELECTION_MODES) {
      expect(isSelectionMode(mode)).toBe(true);
    }
  });
  it("rejects everything else (typed-narrow guard)", () => {
    expect(isSelectionMode("looped")).toBe(false);
    expect(isSelectionMode("")).toBe(false);
    expect(isSelectionMode(undefined)).toBe(false);
    expect(isSelectionMode(0)).toBe(false);
    expect(isSelectionMode(null)).toBe(false);
  });
});

describe("applySelectionMode", () => {
  const xs = ["a", "b", "c", "d"];

  describe("empty items", () => {
    it("returns no items and a 0 cursor for every mode", () => {
      for (const mode of SELECTION_MODES) {
        expect(
          applySelectionMode({
            items: [],
            mode,
            cursor: 7, // garbage cursor — must not leak into the result
            range: { start: 0, end: 0 },
            random: () => 0.5,
          }),
        ).toEqual({ items: [], nextCursor: 0 });
      }
    });
  });

  describe("fixed", () => {
    it("emits items[cursor] without advancing the cursor", () => {
      expect(
        applySelectionMode({ items: xs, mode: "fixed", cursor: 2 }),
      ).toEqual({ items: ["c"], nextCursor: 2 });
    });
    it("clamps a cursor past the end down to N-1", () => {
      expect(
        applySelectionMode({ items: xs, mode: "fixed", cursor: 99 }),
      ).toEqual({ items: ["d"], nextCursor: 3 });
    });
    it("clamps a negative cursor up to 0", () => {
      expect(
        applySelectionMode({ items: xs, mode: "fixed", cursor: -3 }),
      ).toEqual({ items: ["a"], nextCursor: 0 });
    });
  });

  describe("increment", () => {
    it("advances by +1", () => {
      expect(
        applySelectionMode({ items: xs, mode: "increment", cursor: 1 }),
      ).toEqual({ items: ["b"], nextCursor: 2 });
    });
    it("wraps from N-1 back to 0", () => {
      // The user explicitly asked for "incremental seed"-style wrap (ADR-0031).
      // After the last item, the next run starts from 0 again.
      expect(
        applySelectionMode({ items: xs, mode: "increment", cursor: 3 }),
      ).toEqual({ items: ["d"], nextCursor: 0 });
    });
    it("emits the cursor item, not the next item — 'cursor is what you see'", () => {
      // Critical contract: the body's <x/N> shows `cursor + 1`, and the
      // user expects what they see is what runs. The cursor is bumped
      // AFTER the emission for the *next* run.
      const result = applySelectionMode({
        items: xs,
        mode: "increment",
        cursor: 0,
      });
      expect(result.items).toEqual(["a"]);
      expect(result.nextCursor).toBe(1);
    });
  });

  describe("decrement", () => {
    it("decrements by 1", () => {
      expect(
        applySelectionMode({ items: xs, mode: "decrement", cursor: 2 }),
      ).toEqual({ items: ["c"], nextCursor: 1 });
    });
    it("wraps from 0 back to N-1", () => {
      expect(
        applySelectionMode({ items: xs, mode: "decrement", cursor: 0 }),
      ).toEqual({ items: ["a"], nextCursor: 3 });
    });
  });

  describe("random", () => {
    it("uses the injected RNG to pick the index and reflects it in nextCursor", () => {
      // Math.floor(0.74 * 4) = 2 → "c"
      const result = applySelectionMode({
        items: xs,
        mode: "random",
        cursor: 0,
        random: () => 0.74,
      });
      expect(result.items).toEqual(["c"]);
      expect(result.nextCursor).toBe(2);
    });
    it("never returns an out-of-range index even if the RNG returns 1.0", () => {
      // Defensive against an injected RNG misbehaving — Math.random
      // can't return 1.0 but injected mocks might.
      const result = applySelectionMode({
        items: xs,
        mode: "random",
        cursor: 0,
        random: () => 1.0,
      });
      expect(result.nextCursor).toBe(3);
      expect(result.items).toEqual(["d"]);
    });
    it("on a 1-item list, deterministically returns index 0 regardless of the RNG", () => {
      const result = applySelectionMode({
        items: ["only"],
        mode: "random",
        cursor: 0,
        random: () => 0.99999,
      });
      expect(result).toEqual({ items: ["only"], nextCursor: 0 });
    });
  });

  describe("range", () => {
    it("emits the inclusive slice without advancing the cursor", () => {
      expect(
        applySelectionMode({
          items: xs,
          mode: "range",
          cursor: 0,
          range: { start: 1, end: 2 },
        }),
      ).toEqual({ items: ["b", "c"], nextCursor: 0 });
    });
    it("swaps inverted ranges silently (start > end)", () => {
      expect(
        applySelectionMode({
          items: xs,
          mode: "range",
          cursor: 0,
          range: { start: 3, end: 1 },
        }),
      ).toEqual({ items: ["b", "c", "d"], nextCursor: 0 });
    });
    it("clamps out-of-bound range indices", () => {
      expect(
        applySelectionMode({
          items: xs,
          mode: "range",
          cursor: 0,
          range: { start: -10, end: 99 },
        }),
      ).toEqual({ items: ["a", "b", "c", "d"], nextCursor: 0 });
    });
    it("falls back to 'all' when no range is provided (defensive)", () => {
      expect(
        applySelectionMode({
          items: xs,
          mode: "range",
          cursor: 1,
        }),
      ).toEqual({ items: ["a", "b", "c", "d"], nextCursor: 1 });
    });
  });

  describe("all", () => {
    it("emits every item without advancing the cursor", () => {
      expect(
        applySelectionMode({ items: xs, mode: "all", cursor: 2 }),
      ).toEqual({ items: ["a", "b", "c", "d"], nextCursor: 2 });
    });
    it("returns a fresh array (not the same reference) so callers can mutate safely", () => {
      const result = applySelectionMode({
        items: xs,
        mode: "all",
        cursor: 0,
      });
      expect(result.items).not.toBe(xs);
    });
  });
});
