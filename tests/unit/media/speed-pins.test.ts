import { describe, expect, it } from "vitest";

import {
  outputDurationFromPins,
  sanitizeSpeedPins,
  sourceTimeFromPins,
  splitSpeedPin,
  removeSpeedPin,
} from "@/lib/media/speed-pins";

describe("speed pins", () => {
  it("always starts at 0s and defaults to 1×", () => {
    const pins = sanitizeSpeedPins(undefined, 10);
    expect(pins).toEqual([{ srcSec: 0, speed: 1 }]);
    expect(outputDurationFromPins(pins, 10)).toBeCloseTo(10);
  });

  it("slow-mo lengthens the output; fast shortens it", () => {
    const pins = sanitizeSpeedPins(
      [
        { srcSec: 0, speed: 1 },
        { srcSec: 4, speed: 0.5 },
      ],
      8,
    );
    // 0–4s at 1× = 4s out; 4–8s at 0.5× = 8s out → 12s
    expect(outputDurationFromPins(pins, 8)).toBeCloseTo(12);
  });

  it("maps output time back onto the source through each zone", () => {
    const pins = [
      { srcSec: 0, speed: 1 },
      { srcSec: 4, speed: 0.5 },
    ];
    expect(sourceTimeFromPins(pins, 2, 8)).toBeCloseTo(2);
    expect(sourceTimeFromPins(pins, 4, 8)).toBeCloseTo(4);
    expect(sourceTimeFromPins(pins, 8, 8)).toBeCloseTo(6);
    expect(sourceTimeFromPins(pins, 12, 8)).toBeCloseTo(8);
  });

  it("splits at a source time and can remove the cut", () => {
    const split = splitSpeedPin([{ srcSec: 0, speed: 1 }], 3.2, 10);
    expect(split).toHaveLength(2);
    expect(split[1]?.srcSec).toBeCloseTo(3.2);
    expect(split[1]?.speed).toBe(1);
    expect(removeSpeedPin(split, 1, 10)).toHaveLength(1);
    expect(removeSpeedPin(split, 0, 10)).toHaveLength(2);
  });
});
