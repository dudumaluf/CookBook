import { describe, expect, it } from "vitest";

import { layerDrawRect } from "@/lib/media/compose-image";

/**
 * Pure-math tests for the Image Stack compositor's fit logic. happy-dom
 * can't render an `OffscreenCanvas`, so we exercise `layerDrawRect`
 * directly (mirrors the compose-image-grid `placementFor` tests).
 */

describe("layerDrawRect", () => {
  it("stretch fills the canvas exactly, ignoring source size", () => {
    expect(layerDrawRect(200, 100, 100, 100, "stretch")).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
  });

  it("contain centres a wide layer inside the canvas (letterbox)", () => {
    // 200×100 into 100×100 → scale 0.5 → 100×50, centred ⇒ y 25.
    expect(layerDrawRect(200, 100, 100, 100, "contain")).toEqual({
      x: 0,
      y: 25,
      w: 100,
      h: 50,
    });
  });

  it("contain centres a tall layer inside the canvas (pillarbox)", () => {
    // 100×200 into 100×100 → scale 0.5 → 50×100, centred ⇒ x 25.
    expect(layerDrawRect(100, 200, 100, 100, "contain")).toEqual({
      x: 25,
      y: 0,
      w: 50,
      h: 100,
    });
  });

  it("cover fills the canvas and overflows a wide layer (negative x)", () => {
    // 200×100 into 100×100 → scale max(0.5,1)=1 → 200×100 ⇒ x -50.
    expect(layerDrawRect(200, 100, 100, 100, "cover")).toEqual({
      x: -50,
      y: 0,
      w: 200,
      h: 100,
    });
  });

  it("matching dimensions are pixel-perfect under any fit (the SAM 3 case)", () => {
    for (const fit of ["stretch", "contain", "cover"] as const) {
      expect(layerDrawRect(1024, 768, 1024, 768, fit)).toEqual({
        x: 0,
        y: 0,
        w: 1024,
        h: 768,
      });
    }
  });

  it("falls back to a full-canvas draw on a zero-size source", () => {
    expect(layerDrawRect(0, 0, 320, 200, "contain")).toEqual({
      x: 0,
      y: 0,
      w: 320,
      h: 200,
    });
  });
});
