import { describe, expect, it } from "vitest";

import {
  isIdentityTransform,
  resolveTransform,
} from "@/lib/media/compose-image";

describe("resolveTransform", () => {
  it("converts percent offsets to canvas pixels and degrees to radians", () => {
    const r = resolveTransform(1000, 500, {
      translateXPct: 10,
      translateYPct: 20,
      rotationDeg: 180,
      scalePct: 50,
    });
    expect(r.tx).toBe(100); // 10% of 1000
    expect(r.ty).toBe(100); // 20% of 500
    expect(r.rad).toBeCloseTo(Math.PI, 6);
    expect(r.scale).toBe(0.5);
  });

  it("defaults to a centered identity (no offset, 0°, 100%)", () => {
    const r = resolveTransform(800, 600, {});
    expect(r).toEqual({ tx: 0, ty: 0, rad: 0, scale: 1 });
  });

  it("clamps scale to a sane positive range (never 0/negative/huge)", () => {
    expect(resolveTransform(100, 100, { scalePct: 0 }).scale).toBe(0.01);
    expect(resolveTransform(100, 100, { scalePct: -50 }).scale).toBe(0.01);
    expect(resolveTransform(100, 100, { scalePct: 5000 }).scale).toBe(20);
  });
});

describe("isIdentityTransform", () => {
  it("is true for empty / explicitly neutral options", () => {
    expect(isIdentityTransform({})).toBe(true);
    expect(
      isIdentityTransform({
        translateXPct: 0,
        translateYPct: 0,
        rotationDeg: 0,
        scalePct: 100,
      }),
    ).toBe(true);
  });

  it("is false once any axis moves", () => {
    expect(isIdentityTransform({ translateXPct: 1 })).toBe(false);
    expect(isIdentityTransform({ translateYPct: -1 })).toBe(false);
    expect(isIdentityTransform({ rotationDeg: 90 })).toBe(false);
    expect(isIdentityTransform({ scalePct: 99 })).toBe(false);
  });
});
