import { describe, expect, it } from "vitest";

import { frameTimestampsMs } from "@/lib/media/frame-timestamps";

/**
 * Pure sampling-math tests — no mediabunny, no DOM.
 */

describe("frameTimestampsMs — count mode", () => {
  it("samples N segment centres across the duration", () => {
    // 4 frames over 4000ms → centres of 4 equal 1000ms segments.
    expect(frameTimestampsMs(4000, { mode: "count", count: 4 })).toEqual([
      500, 1500, 2500, 3500,
    ]);
  });

  it("returns the midpoint for a single frame", () => {
    expect(frameTimestampsMs(4000, { mode: "count", count: 1 })).toEqual([2000]);
  });

  it("never lands on t=0 or t=duration exactly", () => {
    const ts = frameTimestampsMs(10000, { mode: "count", count: 5 });
    expect(ts[0]).toBeGreaterThan(0);
    expect(ts[ts.length - 1]!).toBeLessThan(10000);
  });

  it("clamps count to maxFrames", () => {
    const ts = frameTimestampsMs(10000, {
      mode: "count",
      count: 100,
      maxFrames: 8,
    });
    expect(ts).toHaveLength(8);
  });

  it("keeps timestamps sorted ascending", () => {
    const ts = frameTimestampsMs(9999, { mode: "count", count: 7 });
    const sorted = [...ts].sort((a, b) => a - b);
    expect(ts).toEqual(sorted);
  });
});

describe("frameTimestampsMs — span mode", () => {
  it("samples endpoint-inclusive across the whole clip", () => {
    // 5 frames over 4000ms → 0, 1000, 2000, 3000, end (clamped 1ms inside).
    expect(frameTimestampsMs(4000, { mode: "span", count: 5 })).toEqual([
      0, 1000, 2000, 3000, 3999,
    ]);
  });

  it("starts at the very beginning and ends at the very end", () => {
    const ts = frameTimestampsMs(10000, { mode: "span", count: 9 });
    expect(ts[0]).toBe(0);
    expect(ts[ts.length - 1]!).toBe(9999);
    expect(ts).toHaveLength(9);
  });

  it("returns just the start for a single frame", () => {
    expect(frameTimestampsMs(4000, { mode: "span", count: 1 })).toEqual([0]);
  });

  it("returns the two endpoints for two frames", () => {
    expect(frameTimestampsMs(4000, { mode: "span", count: 2 })).toEqual([
      0, 3999,
    ]);
  });

  it("jitter=0 is identical to even spacing", () => {
    const even = frameTimestampsMs(8000, { mode: "span", count: 5 });
    const jittered0 = frameTimestampsMs(8000, {
      mode: "span",
      count: 5,
      jitter: 0,
      seed: 42,
    });
    expect(jittered0).toEqual(even);
  });

  it("jitter perturbs interior frames but keeps endpoints pinned", () => {
    const even = frameTimestampsMs(8000, { mode: "span", count: 5 });
    const jittered = frameTimestampsMs(8000, {
      mode: "span",
      count: 5,
      jitter: 1,
      seed: 7,
    });
    // Endpoints unchanged.
    expect(jittered[0]).toBe(0);
    expect(jittered[jittered.length - 1]!).toBe(7999);
    // At least one interior frame moved off the even grid.
    expect(jittered.slice(1, -1)).not.toEqual(even.slice(1, -1));
  });

  it("is deterministic for a given seed and varies across seeds", () => {
    const a1 = frameTimestampsMs(8000, { mode: "span", count: 6, jitter: 0.8, seed: 1 });
    const a2 = frameTimestampsMs(8000, { mode: "span", count: 6, jitter: 0.8, seed: 1 });
    const b = frameTimestampsMs(8000, { mode: "span", count: 6, jitter: 0.8, seed: 2 });
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
  });

  it("stays sorted ascending even with heavy jitter", () => {
    const ts = frameTimestampsMs(9999, {
      mode: "span",
      count: 12,
      jitter: 1,
      seed: 99,
    });
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it("clamps count to maxFrames", () => {
    const ts = frameTimestampsMs(10000, {
      mode: "span",
      count: 100,
      maxFrames: 6,
    });
    expect(ts).toHaveLength(6);
  });
});

describe("frameTimestampsMs — interval mode", () => {
  it("samples every interval starting at 0", () => {
    expect(
      frameTimestampsMs(5000, { mode: "interval", intervalSec: 1 }),
    ).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it("stops before the duration (exclusive upper bound)", () => {
    const ts = frameTimestampsMs(3000, { mode: "interval", intervalSec: 1 });
    expect(ts.every((t) => t < 3000)).toBe(true);
  });

  it("caps a tiny interval on a long video at maxFrames", () => {
    const ts = frameTimestampsMs(600_000, {
      mode: "interval",
      intervalSec: 0.1,
      maxFrames: 64,
    });
    expect(ts).toHaveLength(64);
  });

  it("emits at least one frame even for sub-interval durations", () => {
    const ts = frameTimestampsMs(200, { mode: "interval", intervalSec: 5 });
    expect(ts).toEqual([0]);
  });
});

describe("frameTimestampsMs — degenerate input", () => {
  it("returns [0] for zero / negative / NaN duration", () => {
    expect(frameTimestampsMs(0, { mode: "count", count: 4 })).toEqual([0]);
    expect(frameTimestampsMs(-10, { mode: "interval", intervalSec: 1 })).toEqual([0]);
    expect(frameTimestampsMs(Number.NaN, { mode: "count", count: 4 })).toEqual([0]);
  });

  it("applies sane defaults when count / interval are omitted", () => {
    // Default count = 4.
    expect(frameTimestampsMs(8000, { mode: "count" })).toHaveLength(4);
    // Default interval = 1s.
    expect(frameTimestampsMs(3000, { mode: "interval" })).toEqual([
      0, 1000, 2000,
    ]);
  });
});
