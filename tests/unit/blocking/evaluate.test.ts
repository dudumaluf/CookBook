import { describe, expect, it } from "vitest";

import { easeUnit, evalTrack, lerpVec3 } from "@/lib/blocking/evaluate";
import type { Keyframe } from "@/types/blocking";

describe("blocking evaluate", () => {
  it("lerps linearly between keys using the outgoing easing", () => {
    const keys: Keyframe[] = [
      { tMs: 0, value: [0, 0, 0], easing: "linear" },
      { tMs: 10, value: [10, 0, 0], easing: "linear" },
    ];
    expect(evalTrack(keys, 0, [0, 0, 0])[0]).toBeCloseTo(0);
    expect(evalTrack(keys, 5, [0, 0, 0])[0]).toBeCloseTo(5);
    expect(evalTrack(keys, 10, [0, 0, 0])[0]).toBeCloseTo(10);
    expect(evalTrack(keys, 99, [0, 0, 0])[0]).toBeCloseTo(10);
  });

  it("easeIn holds near the start, easeOut near the end", () => {
    expect(easeUnit(0.5, "linear")).toBeCloseTo(0.5);
    expect(easeUnit(0.5, "easeIn")).toBeCloseTo(0.25);
    expect(easeUnit(0.5, "easeOut")).toBeCloseTo(0.75);
    expect(easeUnit(0.5, "easeInOut")).toBeCloseTo(0.5);
  });

  it("lerpVec3 is component-wise", () => {
    expect(lerpVec3([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3]);
  });
});
