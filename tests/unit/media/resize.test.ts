import { describe, expect, it } from "vitest";

import { resolveResize } from "@/lib/media/resize";

describe("resolveResize — pure geometry", () => {
  describe("stretch", () => {
    it("fills the exact box, ignoring aspect (distorts)", () => {
      const g = resolveResize(100, 50, 200, 200, "stretch");
      expect(g).toEqual({
        outW: 200,
        outH: 200,
        drawX: 0,
        drawY: 0,
        drawW: 200,
        drawH: 200,
      });
    });
  });

  describe("contain (Fit)", () => {
    it("scales to fit inside + letterboxes to the exact box", () => {
      // 100×50 into 200×200 → scale 2 → 200×100, centered vertically.
      const g = resolveResize(100, 50, 200, 200, "contain");
      expect(g.outW).toBe(200);
      expect(g.outH).toBe(200);
      expect(g.drawW).toBe(200);
      expect(g.drawH).toBe(100);
      expect(g.drawX).toBe(0);
      expect(g.drawY).toBe(50);
    });

    it("falls back to the source axis when only one axis is given", () => {
      // width 200, height unset → box 200×50(src) → scale min(2,1)=1.
      const g = resolveResize(100, 50, 200, 0, "contain");
      expect(g.outW).toBe(200);
      expect(g.outH).toBe(50);
      expect(g.drawW).toBe(100);
      expect(g.drawH).toBe(50);
      expect(g.drawX).toBe(50);
      expect(g.drawY).toBe(0);
    });
  });

  describe("cover (Fill)", () => {
    it("scales to fill the box + crops the overflow (centered)", () => {
      // 100×50 into 200×200 → scale max(2,4)=4 → 400×200, overflow cropped.
      const g = resolveResize(100, 50, 200, 200, "cover");
      expect(g.outW).toBe(200);
      expect(g.outH).toBe(200);
      expect(g.drawW).toBe(400);
      expect(g.drawH).toBe(200);
      expect(g.drawX).toBe(-100);
      expect(g.drawY).toBe(0);
    });
  });

  describe("scale (keep ratio, no pad)", () => {
    it("fits inside the box and outputs the scaled size (no padding)", () => {
      const g = resolveResize(100, 50, 200, 200, "scale");
      expect(g.outW).toBe(200);
      expect(g.outH).toBe(100);
      expect(g).toMatchObject({ drawX: 0, drawY: 0, drawW: 200, drawH: 100 });
    });

    it("derives height from width when only width is given", () => {
      const g = resolveResize(100, 50, 200, 0, "scale");
      expect(g).toMatchObject({ outW: 200, outH: 100 });
    });

    it("derives width from height when only height is given", () => {
      const g = resolveResize(100, 50, 0, 200, "scale");
      expect(g).toMatchObject({ outW: 400, outH: 200 });
    });

    it("is an identity when neither axis is given", () => {
      const g = resolveResize(640, 360, 0, 0, "scale");
      expect(g).toMatchObject({ outW: 640, outH: 360 });
    });

    it("upscales when the box is larger than the source", () => {
      const g = resolveResize(320, 180, 1280, 1280, "scale");
      expect(g).toMatchObject({ outW: 1280, outH: 720 });
    });
  });

  describe("edges", () => {
    it("rounds fractional source dimensions and never collapses to zero", () => {
      const g = resolveResize(99.6, 50.4, 0, 0, "scale");
      expect(g.outW).toBe(100);
      expect(g.outH).toBe(50);
    });

    it("clamps a zero source to a 1px floor", () => {
      const g = resolveResize(0, 0, 100, 100, "contain");
      expect(g.outW).toBe(100);
      expect(g.outH).toBe(100);
      expect(g.drawW).toBeGreaterThan(0);
      expect(g.drawH).toBeGreaterThan(0);
    });
  });
});
