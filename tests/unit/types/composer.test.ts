import { describe, expect, it } from "vitest";

import {
  BLEND_MODES,
  canvasBlendMode,
  clamp01,
  clampScale,
  createDefaultDocument,
  createLayer,
  cssBlendMode,
  firstImageRef,
  isLayerDrawable,
  layerBaseSize,
  moveLayer,
  patchLayerTransform,
  placeLayer,
  resolveLayerUrl,
  resolveLayerUrls,
  resolveMaskUrl,
  resolveMaskUrls,
  sanitizeComposerDocument,
  updateLayerById,
  type ComposerLayer,
} from "@/types/composer";

const inputLayer = (handle: string): ComposerLayer =>
  createLayer({ source: { kind: "input", inputHandle: handle } });

describe("blend-mode mapping", () => {
  it("CSS is identity (same names)", () => {
    expect(cssBlendMode("normal")).toBe("normal");
    expect(cssBlendMode("multiply")).toBe("multiply");
    expect(cssBlendMode("luminosity")).toBe("luminosity");
  });

  it("canvas maps normal → source-over, else identity", () => {
    expect(canvasBlendMode("normal")).toBe("source-over");
    expect(canvasBlendMode("screen")).toBe("screen");
    expect(canvasBlendMode("color-dodge")).toBe("color-dodge");
  });

  it("ships the full 16-mode set", () => {
    expect(BLEND_MODES).toHaveLength(16);
    expect(BLEND_MODES[0]).toBe("normal");
  });
});

describe("clamps", () => {
  it("clamp01 keeps [0,1] and rejects NaN", () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(1);
  });
  it("clampScale floors at 0.01 and ceils at 50", () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(0)).toBe(0.01);
    expect(clampScale(999)).toBe(50);
  });
});

describe("layerBaseSize", () => {
  it("contain fits inside without distortion", () => {
    expect(layerBaseSize(200, 100, 100, 100, "contain")).toEqual({ w: 100, h: 50 });
  });
  it("cover fills and overflows", () => {
    expect(layerBaseSize(200, 100, 100, 100, "cover")).toEqual({ w: 200, h: 100 });
  });
  it("stretch is the canvas; none is the natural size", () => {
    expect(layerBaseSize(200, 100, 100, 100, "stretch")).toEqual({ w: 100, h: 100 });
    expect(layerBaseSize(200, 100, 100, 100, "none")).toEqual({ w: 200, h: 100 });
  });
});

describe("placeLayer", () => {
  it("centers by default and applies the user scale", () => {
    const layer = createLayer({
      source: { kind: "input", inputHandle: "layer-0" },
      fit: "contain",
      transform: { scale: 2 },
    });
    const p = placeLayer(layer, 200, 100, 100, 100);
    expect(p.cx).toBe(50);
    expect(p.cy).toBe(50);
    expect(p.w).toBe(200); // 100 (contain base) × 2
    expect(p.h).toBe(100);
    expect(p.rad).toBe(0);
  });

  it("offsets by xPct/yPct and converts rotation to radians", () => {
    const layer = createLayer({
      source: { kind: "solid", color: "#fff" },
      transform: { xPct: 0.25, yPct: 0.75, rotationDeg: 90 },
    });
    const p = placeLayer(layer, 100, 100, 200, 80);
    expect(p.cx).toBe(50);
    expect(p.cy).toBe(60);
    expect(p.rad).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe("source resolution", () => {
  const inputs = { "layer-0": { url: "https://x/a.png" } };

  it("resolves input layers from the wired ref", () => {
    expect(resolveLayerUrl(inputLayer("layer-0"), inputs)).toBe("https://x/a.png");
    expect(resolveLayerUrl(inputLayer("layer-9"), inputs)).toBeUndefined();
  });

  it("solid + url layers", () => {
    expect(
      resolveLayerUrl(createLayer({ source: { kind: "solid", color: "#000" } }), inputs),
    ).toBeUndefined();
    expect(
      resolveLayerUrl(
        createLayer({ source: { kind: "url", url: "https://y/b.png" } }),
        inputs,
      ),
    ).toBe("https://y/b.png");
  });

  it("resolveLayerUrls maps by layer id", () => {
    const a = inputLayer("layer-0");
    const doc = { ...createDefaultDocument(), layers: [a] };
    expect(resolveLayerUrls(doc, inputs)).toEqual({ [a.id]: "https://x/a.png" });
  });

  it("isLayerDrawable: hidden = false, unresolved input = false, solid w/ color = true", () => {
    const hidden = { ...inputLayer("layer-0"), visible: false };
    expect(isLayerDrawable(hidden, inputs)).toBe(false);
    expect(isLayerDrawable(inputLayer("layer-3"), inputs)).toBe(false);
    expect(
      isLayerDrawable(createLayer({ source: { kind: "solid", color: "#000" } }), inputs),
    ).toBe(true);
    expect(isLayerDrawable(inputLayer("layer-0"), inputs)).toBe(true);
  });
});

describe("mask resolution", () => {
  const inputs = {
    "layer-0": { url: "https://x/a.png" },
    "layer-1": { url: "https://x/matte.png" },
  };

  it("resolveMaskUrl: undefined when no mask, else resolves the matte source", () => {
    expect(resolveMaskUrl(inputLayer("layer-0"), inputs)).toBeUndefined();

    const wired: ComposerLayer = {
      ...inputLayer("layer-0"),
      mask: {
        source: { kind: "input", inputHandle: "layer-1" },
        mode: "alpha",
        invert: false,
      },
    };
    expect(resolveMaskUrl(wired, inputs)).toBe("https://x/matte.png");

    const urlMask: ComposerLayer = {
      ...inputLayer("layer-0"),
      mask: { source: { kind: "url", url: "https://y/m.png" }, mode: "luma", invert: true },
    };
    expect(resolveMaskUrl(urlMask, inputs)).toBe("https://y/m.png");

    const dangling: ComposerLayer = {
      ...inputLayer("layer-0"),
      mask: {
        source: { kind: "input", inputHandle: "layer-9" },
        mode: "alpha",
        invert: false,
      },
    };
    expect(resolveMaskUrl(dangling, inputs)).toBeUndefined();
  });

  it("resolveMaskUrls only includes masked layers, keyed by layer id", () => {
    const plain = inputLayer("layer-0");
    const masked: ComposerLayer = {
      ...inputLayer("layer-0"),
      mask: {
        source: { kind: "input", inputHandle: "layer-1" },
        mode: "alpha",
        invert: false,
      },
    };
    const doc = { ...createDefaultDocument(), layers: [plain, masked] };
    expect(resolveMaskUrls(doc, inputs)).toEqual({ [masked.id]: "https://x/matte.png" });
  });
});

describe("layer array helpers", () => {
  it("moveLayer swaps within bounds and no-ops at the edges", () => {
    const a = inputLayer("layer-0");
    const b = inputLayer("layer-1");
    const c = inputLayer("layer-2");
    expect(moveLayer([a, b, c], b.id, 1).map((l) => l.id)).toEqual([a.id, c.id, b.id]);
    expect(moveLayer([a, b, c], a.id, -1).map((l) => l.id)).toEqual([a.id, b.id, c.id]);
  });

  it("updateLayerById patches only the target", () => {
    const a = inputLayer("layer-0");
    const b = inputLayer("layer-1");
    const next = updateLayerById([a, b], b.id, { opacity: 0.5 });
    expect(next[1]!.opacity).toBe(0.5);
    expect(next[0]!.opacity).toBe(1);
  });

  it("patchLayerTransform merges into the layer transform", () => {
    const a = createLayer({ source: { kind: "solid", color: "#000" } });
    const next = patchLayerTransform([a], a.id, { rotationDeg: 45 });
    expect(next[0]!.transform.rotationDeg).toBe(45);
    expect(next[0]!.transform.scale).toBe(1); // untouched
  });
});

describe("sanitizeComposerDocument", () => {
  it("returns a valid default for junk input", () => {
    const d = sanitizeComposerDocument(undefined);
    expect(d).toEqual(createDefaultDocument());
    expect(sanitizeComposerDocument("nope").layers).toEqual([]);
  });

  it("clamps the canvas box and keeps a string background", () => {
    const d = sanitizeComposerDocument({ width: 99999, height: -5, background: "#abc" });
    expect(d.width).toBe(8192);
    expect(d.height).toBe(16); // MIN_CANVAS
    expect(d.background).toBe("#abc");
  });

  it("drops layers with no recoverable source", () => {
    const d = sanitizeComposerDocument({
      layers: [{ name: "ghost" }, { source: { kind: "solid", color: "#111" } }],
    });
    expect(d.layers).toHaveLength(1);
    expect(d.layers[0]!.source.kind).toBe("solid");
  });

  it("coerces bad blend / fit / numbers to safe values", () => {
    const d = sanitizeComposerDocument({
      layers: [
        {
          source: { kind: "input", inputHandle: "layer-0" },
          blendMode: "not-a-mode",
          fit: "weird",
          opacity: 5,
          transform: { scale: 0, rotationDeg: 720, xPct: 0.3 },
        },
      ],
    });
    const l = d.layers[0]!;
    expect(l.blendMode).toBe("normal");
    expect(l.fit).toBe("contain");
    expect(l.opacity).toBe(1);
    expect(l.transform.scale).toBe(0.01);
    expect(l.transform.rotationDeg).toBe(0); // 720 % 360
    expect(l.transform.xPct).toBe(0.3);
  });
});

describe("factories + firstImageRef", () => {
  it("createLayer applies sane defaults", () => {
    const l = createLayer({ source: { kind: "solid", color: "#000" } });
    expect(l.visible).toBe(true);
    expect(l.opacity).toBe(1);
    expect(l.blendMode).toBe("normal");
    expect(l.fit).toBe("contain");
    expect(l.transform).toEqual({ xPct: 0.5, yPct: 0.5, scale: 1, rotationDeg: 0 });
  });

  it("firstImageRef narrows single + array outputs", () => {
    expect(firstImageRef({ type: "image", value: { url: "u" } })?.url).toBe("u");
    expect(firstImageRef([{ type: "image", value: { url: "v" } }])?.url).toBe("v");
    expect(firstImageRef({ type: "text", value: "hi" })).toBeUndefined();
    expect(firstImageRef(undefined)).toBeUndefined();
  });
});
