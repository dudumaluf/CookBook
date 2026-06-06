import { describe, expect, it } from "vitest";

import {
  aspectFromFirstMediaDimensions,
  aspectFromImageDimensions,
  aspectFromMediaDimensions,
  parseAspectRatio,
} from "@/lib/utils/aspect-ratio";

describe("parseAspectRatio (Slice 5.6.2)", () => {
  it("parses Higgsfield-style aspect strings into ratio + CSS aspect", () => {
    expect(parseAspectRatio("16:9")).toEqual({
      ratio: 16 / 9,
      cssAspect: "16 / 9",
    });
    expect(parseAspectRatio("9:16")).toEqual({
      ratio: 9 / 16,
      cssAspect: "9 / 16",
    });
    expect(parseAspectRatio("1:1")).toEqual({
      ratio: 1,
      cssAspect: "1 / 1",
    });
    expect(parseAspectRatio("3:4")).toEqual({
      ratio: 0.75,
      cssAspect: "3 / 4",
    });
  });

  it("returns null for malformed / empty / nullish input", () => {
    expect(parseAspectRatio("")).toBeNull();
    expect(parseAspectRatio("abc")).toBeNull();
    expect(parseAspectRatio("16")).toBeNull();        // missing colon
    expect(parseAspectRatio("16:")).toBeNull();       // empty height
    expect(parseAspectRatio(":9")).toBeNull();        // empty width
    expect(parseAspectRatio("a:b")).toBeNull();
    expect(parseAspectRatio(undefined)).toBeNull();
    expect(parseAspectRatio(null)).toBeNull();
  });

  it("returns null when either side is zero or negative (avoid NaN ratio)", () => {
    expect(parseAspectRatio("16:0")).toBeNull();
    expect(parseAspectRatio("0:9")).toBeNull();
    expect(parseAspectRatio("-1:9")).toBeNull();
    expect(parseAspectRatio("16:-9")).toBeNull();
  });
});

describe("aspectFromImageDimensions (Slice 5.6.2)", () => {
  it("returns '<w> / <h>' as CSS aspect-ratio shorthand", () => {
    expect(aspectFromImageDimensions(1920, 1080)).toBe("1920 / 1080");
    expect(aspectFromImageDimensions(1024, 1024)).toBe("1024 / 1024");
    expect(aspectFromImageDimensions(720, 1280)).toBe("720 / 1280");
  });

  it("falls back to '1 / 1' on zero / negative / non-finite dimensions", () => {
    expect(aspectFromImageDimensions(0, 100)).toBe("1 / 1");
    expect(aspectFromImageDimensions(100, 0)).toBe("1 / 1");
    expect(aspectFromImageDimensions(-5, 100)).toBe("1 / 1");
    expect(aspectFromImageDimensions(100, -5)).toBe("1 / 1");
    expect(aspectFromImageDimensions(Number.NaN, 100)).toBe("1 / 1");
    expect(aspectFromImageDimensions(100, Number.POSITIVE_INFINITY)).toBe(
      "1 / 1",
    );
  });
});

describe("aspectFromMediaDimensions", () => {
  it("reads width/height from ImageRef-style metadata", () => {
    expect(
      aspectFromMediaDimensions({ width: 1080, height: 1920 }),
    ).toBe("1080 / 1920");
  });

  it("falls back when metadata is missing", () => {
    expect(aspectFromMediaDimensions({ url: "x" } as never)).toBe("16 / 9");
    expect(aspectFromMediaDimensions(undefined, "3 / 4")).toBe("3 / 4");
  });
});

describe("aspectFromFirstMediaDimensions", () => {
  it("returns the first ref with valid dimensions", () => {
    expect(
      aspectFromFirstMediaDimensions([
        undefined,
        { width: 1080, height: 1920 },
        { width: 1920, height: 1080 },
      ]),
    ).toBe("1080 / 1920");
  });

  it("returns null when no ref has dimensions", () => {
    expect(aspectFromFirstMediaDimensions([{}, { url: "x" } as never])).toBeNull();
  });
});
