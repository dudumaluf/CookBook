import { beforeEach, describe, expect, it, vi } from "vitest";

const { transformImage, uploadImageAsset } = vi.hoisted(() => ({
  transformImage: vi.fn(),
  uploadImageAsset: vi.fn(),
}));
// Keep the real isIdentityTransform (pure) — only stub the canvas leg.
vi.mock("@/lib/media/compose-image", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/media/compose-image")>();
  return { ...actual, transformImage };
});
vi.mock("@/lib/library/upload-asset", () => ({ uploadImageAsset }));

import {
  hasImageTransformOverrides,
  imageTransformNodeSchema,
} from "@/components/nodes/node-image-transform";
import { _resetPreviewRenderCache } from "@/lib/media/preview-cache";
import type { ExecContext, StandardizedOutput } from "@/types/node";

const img = (url: string): StandardizedOutput => ({
  type: "image",
  value: { url },
});

function ctx(
  inputs: Record<string, StandardizedOutput | StandardizedOutput[] | undefined>,
  config: Record<string, unknown> = {},
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
  transformImage.mockReset();
  uploadImageAsset.mockReset();
  transformImage.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  uploadImageAsset.mockResolvedValue({ url: "https://cdn/transform.png" });
  blobCounter = 0;
  urlAny.createObjectURL = () => `blob:t-${++blobCounter}`;
  urlAny.revokeObjectURL = () => {};
  _resetPreviewRenderCache();
});

describe("image-transform node execute", () => {
  it("throws when no image is wired", async () => {
    await expect(
      imageTransformNodeSchema.execute!(ctx({}) as never),
    ).rejects.toThrow(/Wire an image/);
  });

  it("passes the source through untouched for an identity transform", async () => {
    const out = (await imageTransformNodeSchema.execute!(
      ctx({ image: img("https://x/me.png") }) as never,
    )) as StandardizedOutput;
    expect(out).toEqual(img("https://x/me.png"));
    expect(transformImage).not.toHaveBeenCalled();
    expect(uploadImageAsset).not.toHaveBeenCalled();
  });

  it("transforms + re-hosts when values change, forwarding percent/deg opts", async () => {
    const result = await imageTransformNodeSchema.execute!(
      ctx(
        { image: img("https://x/me.png") },
        { translateX: 10, rotation: 90, scale: 50 },
      ) as never,
    );
    expect(transformImage).toHaveBeenCalledWith("https://x/me.png", {
      translateXPct: 10,
      translateYPct: 0,
      rotationDeg: 90,
      scalePct: 50,
    });
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("image");
    if (out.type === "image") {
      expect(out.value.url).toBe("https://cdn/transform.png");
    }
  });

  it("preview mode renders a local blob — no upload", async () => {
    const out = (await imageTransformNodeSchema.execute!(
      ctx(
        { image: img("https://x/me.png") },
        { translateX: 10 },
        /* preview */ true,
      ) as never,
    )) as StandardizedOutput;

    expect(transformImage).toHaveBeenCalledTimes(1);
    expect(uploadImageAsset).not.toHaveBeenCalled(); // no Supabase round-trip
    expect(out.type).toBe("image");
    if (out.type === "image") {
      expect(out.value.url).toMatch(/^blob:/);
    }
  });

  it("preview reuses the render across ticks with unchanged values", async () => {
    const cfg = { rotation: 15 };
    await imageTransformNodeSchema.execute!(
      ctx({ image: img("https://x/me.png") }, cfg, true) as never,
    );
    await imageTransformNodeSchema.execute!(
      ctx({ image: img("https://x/me.png") }, cfg, true) as never,
    );
    // Memo hit on the second tick — only one re-encode for the same state.
    expect(transformImage).toHaveBeenCalledTimes(1);
  });
});

describe("hasImageTransformOverrides", () => {
  it("is false at defaults and true once any value changes", () => {
    expect(hasImageTransformOverrides({})).toBe(false);
    expect(hasImageTransformOverrides({ translateX: 0, scale: 100 })).toBe(
      false,
    );
    expect(hasImageTransformOverrides({ rotation: 5 })).toBe(true);
    expect(hasImageTransformOverrides({ scale: 120 })).toBe(true);
    expect(hasImageTransformOverrides({ translateY: -3 })).toBe(true);
  });
});
