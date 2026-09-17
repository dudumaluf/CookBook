import { describe, expect, it } from "vitest";

import {
  hasAnyKeep,
  isIdentityCut,
  outputDurationFromCuts,
  removeCutPin,
  sanitizeCutPins,
  shouldPassthroughCut,
  sourceTimeFromCuts,
  splitCutPin,
} from "@/lib/media/cut-pins";

describe("cut pins", () => {
  it("defaults to keep-all and is a passthrough", () => {
    const pins = sanitizeCutPins(undefined, 10);
    expect(pins).toEqual([{ srcSec: 0, keep: true }]);
    expect(outputDurationFromCuts(pins, 10)).toBeCloseTo(10);
    expect(isIdentityCut(pins, 10)).toBe(true);
    expect(shouldPassthroughCut(pins, 10)).toBe(true);
  });

  it("ripple-deletes a middle zone and joins the leftovers", () => {
    const pins = sanitizeCutPins(
      [
        { srcSec: 0, keep: true },
        { srcSec: 3, keep: false },
        { srcSec: 5, keep: true },
      ],
      10,
    );
    // keep 0–3 + 5–10 = 8s
    expect(outputDurationFromCuts(pins, 10)).toBeCloseTo(8);
    expect(sourceTimeFromCuts(pins, 0, 10)).toBeCloseTo(0);
    expect(sourceTimeFromCuts(pins, 3, 10)).toBeCloseTo(3);
    expect(sourceTimeFromCuts(pins, 3.5, 10)).toBeCloseTo(5.5);
    expect(sourceTimeFromCuts(pins, 8, 10)).toBeCloseTo(10);
    expect(isIdentityCut(pins, 10)).toBe(false);
    expect(shouldPassthroughCut(pins, 10)).toBe(false);
  });

  it("can drop the start or the end", () => {
    const dropStart = [
      { srcSec: 0, keep: false },
      { srcSec: 2, keep: true },
    ];
    expect(outputDurationFromCuts(dropStart, 8)).toBeCloseTo(6);
    expect(sourceTimeFromCuts(dropStart, 0, 8)).toBeCloseTo(2);

    const dropEnd = [
      { srcSec: 0, keep: true },
      { srcSec: 6, keep: false },
    ];
    expect(outputDurationFromCuts(dropEnd, 8)).toBeCloseTo(6);
    expect(sourceTimeFromCuts(dropEnd, 6, 8)).toBeCloseTo(6);
  });

  it("rejects an all-cut timeline", () => {
    const pins = [{ srcSec: 0, keep: false }];
    expect(hasAnyKeep(pins, 10)).toBe(false);
    expect(outputDurationFromCuts(pins, 10)).toBe(0);
  });

  it("splits at a source time and can remove the cut", () => {
    const split = splitCutPin([{ srcSec: 0, keep: true }], 3.2, 10);
    expect(split).toHaveLength(2);
    expect(split[1]?.srcSec).toBeCloseTo(3.2);
    expect(split[1]?.keep).toBe(true);
    expect(removeCutPin(split, 1, 10)).toHaveLength(1);
    expect(removeCutPin(split, 0, 10)).toHaveLength(2);
  });

  it("treats extra keep-only splits as a passthrough", () => {
    const pins = [
      { srcSec: 0, keep: true },
      { srcSec: 4, keep: true },
    ];
    expect(shouldPassthroughCut(pins, 10)).toBe(true);
    expect(shouldPassthroughCut(pins, 0)).toBe(true);
  });
});
