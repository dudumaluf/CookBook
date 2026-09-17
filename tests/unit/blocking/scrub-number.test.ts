import { describe, expect, it } from "vitest";

import { applyScrubDelta, clampScrub } from "@/components/nodes/blocking/scrub-number";

describe("applyScrubDelta", () => {
  it("moves 0.01 per pixel", () => {
    expect(applyScrubDelta(1, 10, false)).toBe(1.1);
    expect(applyScrubDelta(1, -10, false)).toBe(0.9);
  });

  it("moves 0.001 per pixel when fine (Shift)", () => {
    expect(applyScrubDelta(1, 10, true)).toBe(1.01);
  });
});

describe("clampScrub", () => {
  it("clamps to min and max", () => {
    expect(clampScrub(0.05, 0.2, 60)).toBe(0.2);
    expect(clampScrub(90, 0.2, 60)).toBe(60);
    expect(clampScrub(3, 0.2, 60)).toBe(3);
  });
});
