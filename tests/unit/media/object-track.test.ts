import { describe, expect, it } from "vitest";

import {
  bboxFromMaskData,
  buildTrack,
  centerAt,
  movingAverage,
  type NormBox,
} from "@/lib/media/object-track";

/** Build an RGBA mask frame (black bg) with a white rect at px coords. */
function maskFrame(
  w: number,
  h: number,
  rect: { x: number; y: number; w: number; h: number } | null,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  if (!rect) return data;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe("bboxFromMaskData", () => {
  it("returns null for an all-black frame", () => {
    expect(bboxFromMaskData(maskFrame(10, 10, null), 10, 10)).toBeNull();
  });

  it("returns the normalised bbox of a white rect", () => {
    const box = bboxFromMaskData(
      maskFrame(10, 10, { x: 2, y: 3, w: 4, h: 2 }),
      10,
      10,
    );
    expect(box).not.toBeNull();
    expect(box!.x).toBeCloseTo(0.2, 5);
    expect(box!.y).toBeCloseTo(0.3, 5);
    expect(box!.w).toBeCloseTo(0.4, 5);
    expect(box!.h).toBeCloseTo(0.2, 5);
  });

  it("treats a dark-grey region below threshold as background", () => {
    const w = 4;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    // luma ~20 (below the 0.15*255≈38 default cutoff)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 20;
      data[i + 1] = 20;
      data[i + 2] = 20;
      data[i + 3] = 255;
    }
    expect(bboxFromMaskData(data, w, h)).toBeNull();
  });

  it("returns null for zero-sized frames", () => {
    expect(bboxFromMaskData(new Uint8ClampedArray(0), 0, 0)).toBeNull();
  });
});

describe("movingAverage", () => {
  it("is the identity for window <= 1", () => {
    expect(movingAverage([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });

  it("averages over a centred window, shrinking at the edges", () => {
    const out = movingAverage([0, 0, 3, 0, 0], 3);
    expect(out[0]).toBeCloseTo(0, 5); // (0+0)/2
    expect(out[2]).toBeCloseTo(1, 5); // (0+3+0)/3
    expect(out[4]).toBeCloseTo(0, 5);
  });

  it("smooths a jump into a ramp", () => {
    const out = movingAverage([0, 0, 0, 1, 1, 1], 3);
    // the boundary index gets pulled toward the neighbours
    expect(out[2]!).toBeGreaterThan(0);
    expect(out[3]!).toBeLessThan(1);
  });
});

describe("buildTrack", () => {
  const frame = (tSec: number, box: NormBox | null) => ({ tSec, box });

  it("returns a whole-frame window for no frames", () => {
    const t = buildTrack([]);
    expect(t.size).toEqual({ w: 1, h: 1 });
    expect(t.centers).toEqual([]);
  });

  it("returns a centred whole-frame window when nothing is detected", () => {
    const t = buildTrack([frame(0, null), frame(1, null)]);
    expect(t.size).toEqual({ w: 1, h: 1 });
    expect(t.centers.every((c) => c.cx === 0.5 && c.cy === 0.5)).toBe(true);
  });

  it("sizes the window to the largest box plus padding", () => {
    const t = buildTrack(
      [frame(0, { x: 0.4, y: 0.4, w: 0.2, h: 0.1 })],
      { padding: 0.15, smoothing: 1 },
    );
    expect(t.size.w).toBeCloseTo(0.2 * 1.15, 5);
    expect(t.size.h).toBeCloseTo(0.1 * 1.15, 5);
    expect(t.centers[0]!.cx).toBeCloseTo(0.5, 5);
    expect(t.centers[0]!.cy).toBeCloseTo(0.45, 5);
  });

  it("carries the last centre forward across a null (occluded) frame", () => {
    const t = buildTrack(
      [
        frame(0, { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }),
        frame(1, null),
        frame(2, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }),
      ],
      { smoothing: 1 },
    );
    // frame 1 (null) reuses frame 0's centre (0.15, 0.15)
    expect(t.centers[1]!.cx).toBeCloseTo(0.15, 5);
    expect(t.centers[1]!.cy).toBeCloseTo(0.15, 5);
  });

  it("back-fills leading nulls with the first valid centre", () => {
    const t = buildTrack(
      [frame(0, null), frame(1, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })],
      { smoothing: 1 },
    );
    expect(t.centers[0]!.cx).toBeCloseTo(0.55, 5);
    expect(t.centers[0]!.cy).toBeCloseTo(0.55, 5);
  });

  it("clamps the centre so the window stays inside the frame", () => {
    const t = buildTrack(
      [frame(0, { x: 0.85, y: 0.0, w: 0.15, h: 0.15 })],
      { padding: 0, smoothing: 1 },
    );
    // size.w = 0.15 → half = 0.075; raw cx = 0.925 must clamp to 0.925? no:
    // max allowed cx = 1 - 0.075 = 0.925, so it stays. push further:
    const t2 = buildTrack(
      [frame(0, { x: 0.9, y: 0.9, w: 0.2, h: 0.2 })],
      { padding: 0, smoothing: 1 },
    );
    const halfW = t2.size.w / 2;
    const halfH = t2.size.h / 2;
    expect(t2.centers[0]!.cx).toBeLessThanOrEqual(1 - halfW + 1e-9);
    expect(t2.centers[0]!.cy).toBeLessThanOrEqual(1 - halfH + 1e-9);
    expect(t.centers[0]!.cx).toBeLessThanOrEqual(1);
  });
});

describe("centerAt", () => {
  const track = buildTrack(
    [
      { tSec: 0, box: { x: 0.0, y: 0.0, w: 0.2, h: 0.2 } },
      { tSec: 1, box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } },
      { tSec: 2, box: { x: 0.8, y: 0.8, w: 0.2, h: 0.2 } },
    ],
    { smoothing: 1 },
  );

  it("returns the nearest-in-time centre", () => {
    expect(centerAt(track, 0).tSec).toBe(0);
    expect(centerAt(track, 0.9).tSec).toBe(1);
    expect(centerAt(track, 5).tSec).toBe(2);
  });

  it("falls back to the centre for an empty track", () => {
    const c = centerAt({ size: { w: 1, h: 1 }, centers: [] }, 3);
    expect(c).toEqual({ tSec: 3, cx: 0.5, cy: 0.5 });
  });
});
