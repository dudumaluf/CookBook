import { describe, expect, it } from "vitest";

import {
  addRemapKey,
  defaultRemapKeys,
  evaluateRemap,
  moveRemapKey,
  outputFrameCount,
  removeRemapKey,
  sanitizeRemapKeys,
  formatRampTime,
  sourceTimeSec,
} from "@/lib/media/time-remap";

describe("evaluateRemap", () => {
  it("is identity on the default linear bezier", () => {
    const keys = defaultRemapKeys();
    expect(evaluateRemap(keys, 0)).toBeCloseTo(0, 3);
    expect(evaluateRemap(keys, 0.5)).toBeCloseTo(0.5, 3);
    expect(evaluateRemap(keys, 1)).toBeCloseTo(1, 3);
  });

  it("freezes when both keys sit at the same source time", () => {
    const keys = sanitizeRemapKeys([
      { u: 0, v: 0.4, out: { du: 1 / 3, dv: 0 } },
      { u: 1, v: 0.4, in: { du: -1 / 3, dv: 0 } },
    ]);
    expect(evaluateRemap(keys, 0.2)).toBeCloseTo(0.4, 3);
    expect(evaluateRemap(keys, 0.8)).toBeCloseTo(0.4, 3);
  });

  it("reverses when the curve goes downhill", () => {
    const keys = sanitizeRemapKeys([
      { u: 0, v: 1, out: { du: 1 / 3, dv: -1 / 3 } },
      { u: 1, v: 0, in: { du: -1 / 3, dv: 1 / 3 } },
    ]);
    expect(evaluateRemap(keys, 0)).toBeCloseTo(1, 3);
    expect(evaluateRemap(keys, 1)).toBeCloseTo(0, 3);
    expect(evaluateRemap(keys, 0.5)).toBeCloseTo(0.5, 2);
  });

  it("falls back to identity when keys are missing", () => {
    expect(evaluateRemap(undefined, 0.25)).toBeCloseTo(0.25, 3);
  });
});

describe("formatRampTime", () => {
  it("formats seconds as m:ss with an optional tenth", () => {
    expect(formatRampTime(0)).toBe("0:00");
    expect(formatRampTime(4)).toBe("0:04");
    expect(formatRampTime(4.2)).toBe("0:04.2");
    expect(formatRampTime(62)).toBe("1:02");
  });
});

describe("sourceTimeSec / outputFrameCount", () => {
  it("maps output seconds through the curve onto the source", () => {
    expect(sourceTimeSec(defaultRemapKeys(), 2, 4, 8)).toBeCloseTo(4, 2);
  });

  it("counts frames from duration × fps", () => {
    expect(outputFrameCount(2, 30)).toBe(60);
    expect(outputFrameCount(0, 30)).toBe(1);
  });
});

describe("key edits", () => {
  it("adds a middle key on the current curve and refuses endpoints", () => {
    const withMid = addRemapKey(defaultRemapKeys(), 0.4);
    expect(withMid).toHaveLength(3);
    expect(withMid[1]?.u).toBeCloseTo(0.4, 2);
    expect(addRemapKey(withMid, 0.4)).toHaveLength(3);
    expect(removeRemapKey(withMid, 0)).toHaveLength(3);
    expect(removeRemapKey(withMid, 1)).toHaveLength(2);
  });

  it("pins the first and last keys to the ends of the graph", () => {
    const moved = moveRemapKey(defaultRemapKeys(), 0, 0.4, 0.2);
    expect(moved[0]?.u).toBe(0);
    expect(moved[0]?.v).toBeCloseTo(0.2, 3);
  });
});
