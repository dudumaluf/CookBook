import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  renderComposite,
  renderCompositeVideo,
  compositeCacheKey,
  uploadImageAsset,
  uploadMediaAsset,
} = vi.hoisted(() => ({
  renderComposite: vi.fn(),
  renderCompositeVideo: vi.fn(),
  compositeCacheKey: vi.fn(),
  uploadImageAsset: vi.fn(),
  uploadMediaAsset: vi.fn(),
}));
vi.mock("@/lib/media/compose-composer", () => ({
  renderComposite,
  renderCompositeVideo,
  compositeCacheKey,
}));
vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset,
  uploadMediaAsset,
}));

import { composerNodeSchema } from "@/components/nodes/node-composer";
import { _resetPreviewRenderCache } from "@/lib/media/preview-cache";
import {
  createDefaultDocument,
  createLayer,
  type ComposerDocument,
} from "@/types/composer";
import type { ExecContext, StandardizedOutput } from "@/types/node";

const img = (url: string): StandardizedOutput => ({ type: "image", value: { url } });
const vid = (url: string): StandardizedOutput => ({ type: "video", value: { url } });

function docWith(layers: ComposerDocument["layers"]): ComposerDocument {
  return { ...createDefaultDocument(), width: 100, height: 100, layers };
}

function timelineDocWith(layers: ComposerDocument["layers"]): ComposerDocument {
  return { ...docWith(layers), durationMs: 4000, fps: 30 };
}

function ctx(
  config: Record<string, unknown>,
  inputs: Record<string, StandardizedOutput | StandardizedOutput[] | undefined> = {},
  preview = false,
): ExecContext {
  return {
    nodeId: "n1",
    config,
    inputs,
    preview,
    signal: new AbortController().signal,
  } as ExecContext;
}

const urlAny = URL as unknown as Record<string, unknown>;
let blobCounter = 0;

beforeEach(() => {
  renderComposite.mockReset();
  renderCompositeVideo.mockReset();
  compositeCacheKey.mockReset();
  uploadImageAsset.mockReset();
  uploadMediaAsset.mockReset();
  renderComposite.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  renderCompositeVideo.mockResolvedValue({
    blob: new Blob(["v"], { type: "video/mp4" }),
    width: 100,
    height: 100,
    durationMs: 4000,
    fps: 30,
    frameCount: 120,
  });
  compositeCacheKey.mockReturnValue("cache-key");
  uploadImageAsset.mockResolvedValue({ url: "https://cdn/composite.png" });
  uploadMediaAsset.mockResolvedValue({ url: "https://cdn/composite.mp4" });
  blobCounter = 0;
  urlAny.createObjectURL = () => `blob:c-${++blobCounter}`;
  urlAny.revokeObjectURL = () => {};
  _resetPreviewRenderCache();
});

describe("composer node schema", () => {
  it("is a reactive compose node emitting an image", () => {
    expect(composerNodeSchema.kind).toBe("composer");
    expect(composerNodeSchema.category).toBe("compose");
    expect(composerNodeSchema.reactive).toBe(true);
    expect(composerNodeSchema.outputs[0]?.dataType).toBe("image");
  });

  it("grows layer sockets with portCount", () => {
    expect(composerNodeSchema.getInputs!({} as never).map((h) => h.id)).toEqual([
      "layer-0",
    ]);
    expect(
      composerNodeSchema.getInputs!({ portCount: 3 } as never).map((h) => h.id),
    ).toEqual(["layer-0", "layer-1", "layer-2"]);
  });

  it("getOutputs flips out image↔video with the doc timeline", () => {
    const imageOut = composerNodeSchema.getOutputs!({
      doc: createDefaultDocument(),
    } as never);
    expect(imageOut[0]?.dataType).toBe("image");

    const videoOut = composerNodeSchema.getOutputs!({
      doc: { ...createDefaultDocument(), durationMs: 5000 },
    } as never);
    expect(videoOut[0]?.dataType).toBe("video");

    // A garbage / zero duration stays image (clampDurationMs guards it).
    const zero = composerNodeSchema.getOutputs!({
      doc: { ...createDefaultDocument(), durationMs: -1 },
    } as never);
    expect(zero[0]?.dataType).toBe("image");
  });
});

describe("composer node execute", () => {
  it("throws when nothing is drawable", async () => {
    const layer = createLayer({ source: { kind: "input", inputHandle: "layer-0" } });
    await expect(
      composerNodeSchema.execute!(
        ctx({ doc: docWith([layer]), portCount: 1 }) as never,
      ),
    ).rejects.toThrow(/at least one visible layer/);
  });

  it("resolves input layers → renderComposite + durable upload", async () => {
    const layer = createLayer({ source: { kind: "input", inputHandle: "layer-0" } });
    const result = await composerNodeSchema.execute!(
      ctx(
        { doc: docWith([layer]), portCount: 1 },
        { "layer-0": img("https://x/a.png") },
      ) as never,
    );

    expect(renderComposite).toHaveBeenCalledWith(
      expect.objectContaining({
        urls: expect.objectContaining({ [layer.id]: "https://x/a.png" }),
      }),
    );
    expect(uploadImageAsset).toHaveBeenCalledTimes(1);
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("image");
    if (out.type === "image") {
      expect(out.value.url).toBe("https://cdn/composite.png");
      expect(out.value.width).toBe(100);
      expect(out.value.height).toBe(100);
    }
  });

  it("resolves a layer's mask matte url and passes it to renderComposite", async () => {
    const layer = createLayer({ source: { kind: "input", inputHandle: "layer-0" } });
    layer.mask = {
      source: { kind: "input", inputHandle: "layer-1" },
      mode: "luma",
      invert: true,
    };
    await composerNodeSchema.execute!(
      ctx(
        { doc: docWith([layer]), portCount: 2 },
        {
          "layer-0": img("https://x/a.png"),
          "layer-1": img("https://x/matte.png"),
        },
      ) as never,
    );

    expect(renderComposite).toHaveBeenCalledWith(
      expect.objectContaining({
        urls: expect.objectContaining({ [layer.id]: "https://x/a.png" }),
        maskUrls: expect.objectContaining({ [layer.id]: "https://x/matte.png" }),
      }),
    );
    expect(compositeCacheKey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ [layer.id]: "https://x/a.png" }),
      expect.objectContaining({ [layer.id]: "https://x/matte.png" }),
      expect.objectContaining({ [layer.id]: "image" }),
    );
  });

  it("resolves a VIDEO input → media kind 'video' into the render + cache key", async () => {
    const layer = createLayer({
      source: { kind: "input", inputHandle: "layer-0", mediaType: "video" },
    });
    await composerNodeSchema.execute!(
      ctx(
        { doc: docWith([layer]), portCount: 1 },
        { "layer-0": vid("https://x/clip.mp4") },
      ) as never,
    );

    expect(renderComposite).toHaveBeenCalledWith(
      expect.objectContaining({
        urls: expect.objectContaining({ [layer.id]: "https://x/clip.mp4" }),
        mediaTypes: expect.objectContaining({ [layer.id]: "video" }),
      }),
    );
    expect(compositeCacheKey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ [layer.id]: "https://x/clip.mp4" }),
      expect.anything(),
      expect.objectContaining({ [layer.id]: "video" }),
    );
  });

  it("a solid layer alone is drawable (no wired input needed)", async () => {
    const solid = createLayer({ source: { kind: "solid", color: "#123456" } });
    const result = await composerNodeSchema.execute!(
      ctx({ doc: docWith([solid]), portCount: 1 }) as never,
    );
    expect(renderComposite).toHaveBeenCalledTimes(1);
    expect((result as { output: StandardizedOutput }).output.type).toBe("image");
  });

  it("preview mode renders a local blob — no upload", async () => {
    const solid = createLayer({ source: { kind: "solid", color: "#000" } });
    const out = (await composerNodeSchema.execute!(
      ctx({ doc: docWith([solid]), portCount: 1 }, {}, /* preview */ true) as never,
    )) as StandardizedOutput;

    expect(renderComposite).toHaveBeenCalledTimes(1);
    expect(uploadImageAsset).not.toHaveBeenCalled();
    expect(out.type).toBe("image");
    if (out.type === "image") expect(out.value.url).toMatch(/^blob:/);
  });

  it("timeline mode: Run encodes a VIDEO and uploads an mp4", async () => {
    const layer = createLayer({
      source: { kind: "input", inputHandle: "layer-0", mediaType: "video" },
    });
    const result = await composerNodeSchema.execute!(
      ctx(
        { doc: timelineDocWith([layer]), portCount: 1 },
        { "layer-0": vid("https://x/clip.mp4") },
      ) as never,
    );

    expect(renderCompositeVideo).toHaveBeenCalledTimes(1);
    expect(renderComposite).not.toHaveBeenCalled();
    expect(uploadMediaAsset).toHaveBeenCalledTimes(1);
    expect(uploadImageAsset).not.toHaveBeenCalled();
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://cdn/composite.mp4");
      expect(out.value.durationMs).toBe(4000);
    }
  });

  it("timeline mode: preview renders a cheap poster still — no encode, no upload", async () => {
    const layer = createLayer({
      source: { kind: "input", inputHandle: "layer-0", mediaType: "video" },
    });
    const out = (await composerNodeSchema.execute!(
      ctx(
        { doc: timelineDocWith([layer]), portCount: 1 },
        { "layer-0": vid("https://x/clip.mp4") },
        /* preview */ true,
      ) as never,
    )) as StandardizedOutput;

    expect(renderComposite).toHaveBeenCalledTimes(1);
    expect(renderCompositeVideo).not.toHaveBeenCalled();
    expect(uploadMediaAsset).not.toHaveBeenCalled();
    expect(out.type).toBe("image");
    if (out.type === "image") expect(out.value.url).toMatch(/^blob:/);
  });
});
