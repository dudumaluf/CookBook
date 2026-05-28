import { describe, expect, it } from "vitest";

import {
  computeMediaWindows,
  countMediaWindows,
} from "@/lib/media/windows";

describe("computeMediaWindows", () => {
  it("splits an exact multiple into equal windows", () => {
    const w = computeMediaWindows({ totalMs: 45000, windowMs: 15000 });
    expect(w).toHaveLength(3);
    expect(w[0]).toEqual({
      index: 0,
      startMs: 0,
      endMs: 15000,
      durationMs: 15000,
    });
    expect(w[2]).toEqual({
      index: 2,
      startMs: 30000,
      endMs: 45000,
      durationMs: 15000,
    });
  });

  it("carries the remainder in the last (shorter) window", () => {
    const w = computeMediaWindows({ totalMs: 40000, windowMs: 15000 });
    expect(w).toHaveLength(3);
    expect(w[2]).toEqual({
      index: 2,
      startMs: 30000,
      endMs: 40000,
      durationMs: 10000,
    });
  });

  it("folds a too-short tail into the previous window when minTailMs set", () => {
    const w = computeMediaWindows({
      totalMs: 31000,
      windowMs: 15000,
      minTailMs: 2000,
    });
    expect(w).toHaveLength(2);
    expect(w[1]).toEqual({
      index: 1,
      startMs: 15000,
      endMs: 31000,
      durationMs: 16000,
    });
  });

  it("does NOT fold a tail at/above minTailMs", () => {
    const w = computeMediaWindows({
      totalMs: 33000,
      windowMs: 15000,
      minTailMs: 2000,
    });
    expect(w).toHaveLength(3);
    expect(w[2]?.durationMs).toBe(3000);
  });

  it("returns a single window when total <= windowMs", () => {
    const w = computeMediaWindows({ totalMs: 8000, windowMs: 15000 });
    expect(w).toHaveLength(1);
    expect(w[0]).toEqual({
      index: 0,
      startMs: 0,
      endMs: 8000,
      durationMs: 8000,
    });
  });

  it("returns empty for non-positive total", () => {
    expect(computeMediaWindows({ totalMs: 0, windowMs: 15000 })).toEqual([]);
    expect(computeMediaWindows({ totalMs: -5, windowMs: 15000 })).toEqual([]);
  });

  it("throws on a non-positive windowMs", () => {
    expect(() =>
      computeMediaWindows({ totalMs: 10000, windowMs: 0 }),
    ).toThrow(/windowMs/);
  });

  it("counts a 4-minute song as 16 windows at 15s", () => {
    expect(countMediaWindows({ totalMs: 240000, windowMs: 15000 })).toBe(16);
  });
});
