import { describe, expect, it } from "vitest";

import { compositeCacheKey, maskCoverage } from "@/lib/media/compose-composer";
import { createDefaultDocument, createLayer } from "@/types/composer";

/**
 * Only the pure `compositeCacheKey` is exercised here — `renderComposite`
 * needs OffscreenCanvas / createImageBitmap, which happy-dom lacks, so it's
 * covered through the node with mocks + in a real browser.
 */
describe("compositeCacheKey", () => {
  const base = () => {
    const layer = createLayer({
      source: { kind: "input", inputHandle: "layer-0" },
    });
    return {
      doc: { ...createDefaultDocument(), width: 100, height: 100, layers: [layer] },
      urls: { [layer.id]: "https://x/a.png" },
      layerId: layer.id,
    };
  };

  it("changes when a transform changes", () => {
    const { doc, urls } = base();
    const k1 = compositeCacheKey(doc, urls);
    const moved = {
      ...doc,
      layers: [
        { ...doc.layers[0]!, transform: { ...doc.layers[0]!.transform, scale: 2 } },
      ],
    };
    expect(compositeCacheKey(moved, urls)).not.toBe(k1);
  });

  it("changes when the resolved url changes", () => {
    const { doc, urls, layerId } = base();
    const k1 = compositeCacheKey(doc, urls);
    expect(compositeCacheKey(doc, { [layerId]: "https://x/b.png" })).not.toBe(k1);
  });

  it("ignores hidden layers (toggling visibility re-renders)", () => {
    const { doc, urls } = base();
    const hidden = { ...doc, layers: [{ ...doc.layers[0]!, visible: false }] };
    expect(compositeCacheKey(hidden, urls)).not.toBe(compositeCacheKey(doc, urls));
  });

  it("encodes the canvas box + background", () => {
    const { doc, urls } = base();
    const k1 = compositeCacheKey(doc, urls);
    expect(compositeCacheKey({ ...doc, width: 200 }, urls)).not.toBe(k1);
    expect(compositeCacheKey({ ...doc, background: "#fff" }, urls)).not.toBe(k1);
  });

  it("is stable when a layer has no mask (back-compat with 2-arg callers)", () => {
    const { doc, urls } = base();
    expect(compositeCacheKey(doc, urls)).toBe(compositeCacheKey(doc, urls, {}));
  });

  it("changes when a mask is added / its mode / invert / matte url changes", () => {
    const { doc, urls, layerId } = base();
    const k0 = compositeCacheKey(doc, urls);

    const masked = {
      ...doc,
      layers: [
        {
          ...doc.layers[0]!,
          mask: {
            source: { kind: "input" as const, inputHandle: "layer-1" },
            mode: "alpha" as const,
            invert: false,
          },
        },
      ],
    };
    const m1 = { [layerId]: "https://x/m.png" };
    const kMasked = compositeCacheKey(masked, urls, m1);
    expect(kMasked).not.toBe(k0);

    // mode flip
    const luma = {
      ...masked,
      layers: [{ ...masked.layers[0]!, mask: { ...masked.layers[0]!.mask!, mode: "luma" as const } }],
    };
    expect(compositeCacheKey(luma, urls, m1)).not.toBe(kMasked);

    // invert flip
    const inv = {
      ...masked,
      layers: [{ ...masked.layers[0]!, mask: { ...masked.layers[0]!.mask!, invert: true } }],
    };
    expect(compositeCacheKey(inv, urls, m1)).not.toBe(kMasked);

    // matte url change
    expect(compositeCacheKey(masked, urls, { [layerId]: "https://x/n.png" })).not.toBe(
      kMasked,
    );
  });
});

describe("maskCoverage", () => {
  it("alpha mode returns the alpha channel verbatim", () => {
    expect(maskCoverage(0, 0, 0, 0, "alpha", false)).toBe(0);
    expect(maskCoverage(255, 12, 99, 128, "alpha", false)).toBe(128);
    expect(maskCoverage(0, 0, 0, 255, "alpha", false)).toBe(255);
  });

  it("luma mode reads luminance, premultiplied by mask alpha", () => {
    // Opaque white → full coverage.
    expect(maskCoverage(255, 255, 255, 255, "luma", false)).toBeCloseTo(255, 5);
    // Opaque black → zero coverage.
    expect(maskCoverage(0, 0, 0, 255, "luma", false)).toBe(0);
    // Fully transparent white → zero coverage (premultiplied).
    expect(maskCoverage(255, 255, 255, 0, "luma", false)).toBe(0);
    // Mid grey, opaque → ~half coverage.
    expect(maskCoverage(128, 128, 128, 255, "luma", false)).toBeCloseTo(128, 0);
  });

  it("invert flips the coverage", () => {
    expect(maskCoverage(0, 0, 0, 255, "alpha", true)).toBe(0);
    expect(maskCoverage(0, 0, 0, 0, "alpha", true)).toBe(255);
    expect(maskCoverage(255, 255, 255, 255, "luma", true)).toBeCloseTo(0, 5);
    expect(maskCoverage(0, 0, 0, 255, "luma", true)).toBeCloseTo(255, 5);
  });

  it("clamps into 0..255", () => {
    expect(maskCoverage(999, 999, 999, 999, "alpha", false)).toBe(255);
    expect(maskCoverage(-50, -50, -50, -50, "alpha", false)).toBe(0);
  });
});
