import { describe, expect, it } from "vitest";

import {
  computeGridLayout,
  placementFor,
} from "@/lib/media/compose-image-grid";

/**
 * Pure-math tests for the grid compositor — no canvas, no DOM. We
 * exercise `computeGridLayout` and `placementFor` directly so the
 * geometry is guaranteed even though happy-dom can't render an
 * `OffscreenCanvas`.
 */

describe("computeGridLayout", () => {
  it("auto-flows N images into the most square grid", () => {
    expect(computeGridLayout(2)).toMatchObject({ cols: 2, rows: 1 });
    expect(computeGridLayout(3)).toMatchObject({ cols: 2, rows: 2 });
    expect(computeGridLayout(4)).toMatchObject({ cols: 2, rows: 2 });
    expect(computeGridLayout(5)).toMatchObject({ cols: 3, rows: 2 });
    expect(computeGridLayout(6)).toMatchObject({ cols: 3, rows: 2 });
    expect(computeGridLayout(9)).toMatchObject({ cols: 3, rows: 3 });
    expect(computeGridLayout(10)).toMatchObject({ cols: 4, rows: 3 });
  });

  it("honours manual cols (rows derive from N)", () => {
    expect(computeGridLayout(7, { cols: 3 })).toMatchObject({
      cols: 3,
      rows: 3,
    });
    expect(computeGridLayout(4, { cols: 4 })).toMatchObject({
      cols: 4,
      rows: 1,
    });
  });

  it("honours manual cols + rows literally (extras drop)", () => {
    const layout = computeGridLayout(10, { cols: 3, rows: 2 });
    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(2);
  });

  it("keeps every cell square when aspect = 1", () => {
    const l = computeGridLayout(4, {
      cellAspect: 1,
      maxOutputEdge: 1024,
    });
    expect(l.cellW).toBe(l.cellH);
    expect(l.canvasW).toBeLessThanOrEqual(1024);
    expect(l.canvasH).toBeLessThanOrEqual(1024);
  });

  it("respects 16:9 cell aspect (wider than tall)", () => {
    const l = computeGridLayout(4, { cellAspect: 16 / 9 });
    expect(l.cellW).toBeGreaterThan(l.cellH);
    // Within rounding tolerance, cellW/cellH ≈ 16/9.
    expect(Math.abs(l.cellW / l.cellH - 16 / 9)).toBeLessThan(0.05);
  });

  it("respects 9:16 cell aspect (taller than wide)", () => {
    const l = computeGridLayout(4, { cellAspect: 9 / 16 });
    expect(l.cellH).toBeGreaterThan(l.cellW);
  });

  it("caps the longer canvas edge at maxOutputEdge", () => {
    const l = computeGridLayout(9, {
      cellAspect: 1,
      maxOutputEdge: 1500,
    });
    expect(Math.max(l.canvasW, l.canvasH)).toBeLessThanOrEqual(1500);
  });

  it("accounts for gap and outer padding in the canvas size", () => {
    const noChrome = computeGridLayout(4, {
      cellAspect: 1,
      maxOutputEdge: 1000,
    });
    const withChrome = computeGridLayout(4, {
      cellAspect: 1,
      maxOutputEdge: 1000,
      gap: 20,
      padding: 30,
    });
    // Canvas budget is the same, so cells must shrink to make room.
    expect(withChrome.cellW).toBeLessThan(noChrome.cellW);
    // Final canvas still fits the cap.
    expect(Math.max(withChrome.canvasW, withChrome.canvasH)).toBeLessThanOrEqual(1000);
  });

  it("never produces zero-size cells, even on absurd inputs", () => {
    const l = computeGridLayout(100, {
      cellAspect: 1,
      maxOutputEdge: 64,
      gap: 8,
      padding: 8,
    });
    expect(l.cellW).toBeGreaterThanOrEqual(1);
    expect(l.cellH).toBeGreaterThanOrEqual(1);
  });
});

describe("placementFor", () => {
  it("stretch fills the cell exactly", () => {
    const p = placementFor(200, 100, 0, 0, 100, 100, "stretch", "mc");
    expect(p).toEqual({
      sx: 0,
      sy: 0,
      sw: 200,
      sh: 100,
      dx: 0,
      dy: 0,
      dw: 100,
      dh: 100,
    });
  });

  it("contain centres a wide image inside a square cell", () => {
    const p = placementFor(200, 100, 0, 0, 100, 100, "contain", "mc");
    // 200×100 scaled to fit 100×100 → 100×50, centred ⇒ y-offset 25.
    expect(p.dw).toBe(100);
    expect(p.dh).toBe(50);
    expect(p.dx).toBe(0);
    expect(p.dy).toBe(25);
  });

  it("contain anchors top-left when anchor = tl", () => {
    const p = placementFor(200, 100, 10, 20, 100, 100, "contain", "tl");
    expect(p.dx).toBe(10);
    expect(p.dy).toBe(20);
  });

  it("contain anchors bottom-right when anchor = br", () => {
    const p = placementFor(200, 100, 0, 0, 100, 100, "contain", "br");
    expect(p.dx).toBe(0);
    expect(p.dy).toBe(50);
  });

  it("cover crops a wide image to fit a square cell (centre)", () => {
    const p = placementFor(200, 100, 0, 0, 100, 100, "cover", "mc");
    // Image is wider than cell ratio (2 vs 1) ⇒ horizontal crop.
    expect(p.sh).toBe(100);
    expect(p.sw).toBe(100);
    expect(p.sx).toBe(50); // (200-100)/2 = 50
    expect(p.sy).toBe(0);
    // Destination always fills the cell.
    expect(p).toMatchObject({ dx: 0, dy: 0, dw: 100, dh: 100 });
  });

  it("cover crops with anchor = tl (left edge)", () => {
    const p = placementFor(200, 100, 0, 0, 100, 100, "cover", "tl");
    expect(p.sx).toBe(0);
    expect(p.sy).toBe(0);
  });

  it("cover crops with anchor = br (right edge)", () => {
    const p = placementFor(200, 100, 0, 0, 100, 100, "cover", "br");
    expect(p.sx).toBe(100); // 200 - 100 = right-aligned crop
    expect(p.sy).toBe(0);
  });

  it("cover crops vertically when image is taller than cell", () => {
    const p = placementFor(100, 200, 0, 0, 100, 100, "cover", "mc");
    expect(p.sw).toBe(100);
    expect(p.sh).toBe(100);
    expect(p.sx).toBe(0);
    expect(p.sy).toBe(50); // (200-100)/2 = 50
  });
});
