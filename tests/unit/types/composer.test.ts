import { describe, expect, it } from "vitest";

import {
  BLEND_MODES,
  canvasBlendMode,
  clamp01,
  clampDurationMs,
  clampFps,
  clampScale,
  createDefaultDocument,
  createLayer,
  cssBlendMode,
  DEFAULT_FPS,
  docDurationMs,
  docFps,
  docFrameCount,
  firstImageRef,
  firstMediaRef,
  isLayerDrawable,
  isTimelineMode,
  layerActiveAt,
  layerBaseSize,
  layerOpacityAt,
  layerSourceTimeMs,
  layerSpan,
  moveLayer,
  patchLayerTransform,
  placeLayer,
  resolveLayerMediaType,
  resolveLayerMediaTypes,
  resolveLayerUrl,
  resolveLayerUrls,
  resolveMaskUrl,
  resolveMaskUrls,
  sanitizeComposerDocument,
  updateLayerById,
  type ComposerInputRef,
  type ComposerLayer,
  type LayerTiming,
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
  const inputs: Record<string, ComposerInputRef> = {
    "layer-0": { url: "https://x/a.png", mediaType: "image" },
  };

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
  const inputs: Record<string, ComposerInputRef> = {
    "layer-0": { url: "https://x/a.png", mediaType: "image" },
    "layer-1": { url: "https://x/matte.png", mediaType: "image" },
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

  it("firstMediaRef tags images and videos with their media kind", () => {
    const img = firstMediaRef({ type: "image", value: { url: "i", width: 4 } });
    expect(img).toEqual({
      url: "i",
      mediaType: "image",
      width: 4,
      height: undefined,
      mime: undefined,
    });

    const vid = firstMediaRef({
      type: "video",
      value: { url: "v", width: 1920, height: 1080, durationMs: 5000 },
    });
    expect(vid?.mediaType).toBe("video");
    expect(vid?.durationMs).toBe(5000);

    // Non-media + array unwrap.
    expect(firstMediaRef({ type: "text", value: "hi" })).toBeUndefined();
    expect(
      firstMediaRef([{ type: "video", value: { url: "first" } }])?.url,
    ).toBe("first");
  });
});

describe("media-kind resolution (Phase 3)", () => {
  it("input layers take the LIVE wired ref's kind over a stale source hint", () => {
    const inputs: Record<string, ComposerInputRef> = {
      "layer-0": { url: "https://x/clip.mp4", mediaType: "video" },
    };
    // Source still says "image" (e.g. wired image, then rewired to a video).
    const layer = createLayer({
      source: { kind: "input", inputHandle: "layer-0", mediaType: "image" },
    });
    expect(resolveLayerMediaType(layer, inputs)).toBe("video");
  });

  it("url/asset layers use the source's own mediaType; solids are image", () => {
    const vidUrl = createLayer({
      source: { kind: "url", url: "https://x/c.mp4", mediaType: "video" },
    });
    expect(resolveLayerMediaType(vidUrl, {})).toBe("video");

    const solid = createLayer({ source: { kind: "solid", color: "#000" } });
    expect(resolveLayerMediaType(solid, {})).toBe("image");
  });

  it("resolveLayerMediaTypes maps every layer id", () => {
    const inputs: Record<string, ComposerInputRef> = {
      "layer-0": { url: "https://x/a.png", mediaType: "image" },
      "layer-1": { url: "https://x/c.mp4", mediaType: "video" },
    };
    const a = inputLayer("layer-0");
    const b = inputLayer("layer-1");
    const doc = { ...createDefaultDocument(), layers: [a, b] };
    expect(resolveLayerMediaTypes(doc, inputs)).toEqual({
      [a.id]: "image",
      [b.id]: "video",
    });
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Timeline math (Phase 4)                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

const timed = (timing: LayerTiming, over: Partial<ComposerLayer> = {}) =>
  ({ ...createLayer({ source: { kind: "solid", color: "#000" } }), timing, ...over });

describe("fps / duration clamps", () => {
  it("clampFps rounds into [1,60], defaults to 30 on garbage", () => {
    expect(clampFps(30)).toBe(30);
    expect(clampFps(23.976)).toBe(24);
    expect(clampFps(0)).toBe(1);
    expect(clampFps(120)).toBe(60);
    expect(clampFps(Number.NaN)).toBe(DEFAULT_FPS);
    expect(clampFps("x")).toBe(DEFAULT_FPS);
    expect(clampFps(undefined)).toBe(DEFAULT_FPS);
  });

  it("clampDurationMs: 0/negative/garbage → 0 (image mode), caps at 10min", () => {
    expect(clampDurationMs(5000)).toBe(5000);
    expect(clampDurationMs(0)).toBe(0);
    expect(clampDurationMs(-100)).toBe(0);
    expect(clampDurationMs(Number.NaN)).toBe(0);
    expect(clampDurationMs(undefined)).toBe(0);
    expect(clampDurationMs(99_999_999)).toBe(600_000);
  });
});

describe("doc timeline accessors", () => {
  it("image-mode doc: durationMs 0, not timeline, no frames", () => {
    const doc = createDefaultDocument();
    expect(docDurationMs(doc)).toBe(0);
    expect(isTimelineMode(doc)).toBe(false);
    expect(docFrameCount(doc)).toBe(0);
    expect(docFps(doc)).toBe(30);
  });

  it("timeline-mode doc: frame count = round(sec * fps), ≥ 1", () => {
    const doc = { ...createDefaultDocument(), durationMs: 4000, fps: 30 };
    expect(isTimelineMode(doc)).toBe(true);
    expect(docFrameCount(doc)).toBe(120);
    expect(docFrameCount({ ...doc, durationMs: 1 })).toBe(1); // never 0 in timeline mode
  });
});

describe("layerSpan", () => {
  it("a layer with no timing spans the whole document", () => {
    const l = createLayer({ source: { kind: "solid", color: "#000" } });
    expect(layerSpan(l, 5000)).toEqual({ startMs: 0, endMs: 5000 });
  });

  it("clamps a span into [0, docDur] and keeps start < end", () => {
    expect(layerSpan(timed({ startMs: 1000, endMs: 3000 }), 5000)).toEqual({
      startMs: 1000,
      endMs: 3000,
    });
    // endMs past the doc clamps to docDur.
    expect(layerSpan(timed({ startMs: 1000, endMs: 9000 }), 5000)).toEqual({
      startMs: 1000,
      endMs: 5000,
    });
    // start beyond doc collapses to a zero-ish span at the end (never active).
    const past = layerSpan(timed({ startMs: 9000, endMs: 9500 }), 5000);
    expect(past.startMs).toBe(5000);
    expect(past.endMs).toBe(5000);
  });
});

describe("layerActiveAt", () => {
  const l = timed({ startMs: 1000, endMs: 3000 });
  it("is half-open [start, end)", () => {
    expect(layerActiveAt(l, 999, 5000)).toBe(false);
    expect(layerActiveAt(l, 1000, 5000)).toBe(true);
    expect(layerActiveAt(l, 2999, 5000)).toBe(true);
    expect(layerActiveAt(l, 3000, 5000)).toBe(false);
  });
  it("hidden layers are never active", () => {
    expect(layerActiveAt(timed({ startMs: 0, endMs: 5000 }, { visible: false }), 100, 5000)).toBe(
      false,
    );
  });
});

describe("layerOpacityAt (fades)", () => {
  it("no fades → base opacity inside the span, 0 outside", () => {
    const l = timed({ startMs: 1000, endMs: 3000 }, { opacity: 0.8 });
    expect(layerOpacityAt(l, 500, 5000)).toBe(0);
    expect(layerOpacityAt(l, 2000, 5000)).toBeCloseTo(0.8, 5);
  });

  it("fade-in ramps linearly from 0 → base across fadeInMs", () => {
    const l = timed({ startMs: 0, endMs: 4000, fadeInMs: 1000 }, { opacity: 1 });
    expect(layerOpacityAt(l, 0, 4000)).toBeCloseTo(0, 5);
    expect(layerOpacityAt(l, 500, 4000)).toBeCloseTo(0.5, 5);
    expect(layerOpacityAt(l, 1000, 4000)).toBeCloseTo(1, 5);
    expect(layerOpacityAt(l, 2000, 4000)).toBeCloseTo(1, 5);
  });

  it("fade-out ramps base → 0 across fadeOutMs at the tail", () => {
    const l = timed({ startMs: 0, endMs: 4000, fadeOutMs: 1000 }, { opacity: 1 });
    expect(layerOpacityAt(l, 3000, 4000)).toBeCloseTo(1, 5);
    expect(layerOpacityAt(l, 3500, 4000)).toBeCloseTo(0.5, 5);
    expect(layerOpacityAt(l, 3999, 4000)).toBeCloseTo(0.001, 3);
  });

  it("fades multiply the base opacity", () => {
    const l = timed({ startMs: 0, endMs: 4000, fadeInMs: 1000 }, { opacity: 0.5 });
    expect(layerOpacityAt(l, 500, 4000)).toBeCloseTo(0.25, 5);
  });
});

describe("layerSourceTimeMs", () => {
  it("maps output time → source time via start + trimIn", () => {
    const l = timed({ startMs: 1000, endMs: 5000, trimInMs: 2000 });
    // At the clip's start, we sample the trim-in point of the source.
    expect(layerSourceTimeMs(l, 1000, 6000)).toBe(2000);
    // 1.5s into the clip → 1.5s past the trim-in point.
    expect(layerSourceTimeMs(l, 2500, 6000)).toBe(3500);
  });
  it("a layer with no timing samples in lockstep with the output", () => {
    const l = createLayer({ source: { kind: "input", inputHandle: "v" } });
    expect(layerSourceTimeMs(l, 1234, 5000)).toBe(1234);
  });
});

describe("sanitize: timeline fields", () => {
  it("keeps a valid duration + fps, drops them for image-mode docs", () => {
    const withTimeline = sanitizeComposerDocument({
      layers: [],
      durationMs: 5000,
      fps: 24,
    });
    expect(withTimeline.durationMs).toBe(5000);
    expect(withTimeline.fps).toBe(24);

    const imageMode = sanitizeComposerDocument({ layers: [] });
    expect(imageMode.durationMs).toBeUndefined();
    expect(imageMode.fps).toBeUndefined();
  });

  it("coerces a garbage duration to image mode and clamps fps", () => {
    const doc = sanitizeComposerDocument({ layers: [], durationMs: -5, fps: 999 });
    expect(doc.durationMs).toBeUndefined();
    expect(doc.fps).toBe(60);
  });

  it("sanitizes per-layer timing (valid kept, garbage dropped → full span)", () => {
    const doc = sanitizeComposerDocument({
      layers: [
        {
          source: { kind: "solid", color: "#000" },
          timing: { startMs: 1000, endMs: 3000, fadeInMs: 500, trimInMs: 0 },
        },
        {
          source: { kind: "solid", color: "#111" },
          timing: { startMs: 3000, endMs: 1000 }, // end <= start → dropped
        },
      ],
    });
    expect(doc.layers[0]?.timing).toEqual({
      startMs: 1000,
      endMs: 3000,
      fadeInMs: 500,
    });
    // trimInMs:0 is dropped (minimal), and the invalid second timing → undefined.
    expect(doc.layers[0]?.timing?.trimInMs).toBeUndefined();
    expect(doc.layers[1]?.timing).toBeUndefined();
  });
});
