import { beforeEach, describe, expect, it, vi } from "vitest";

const { cropImage, uploadImageAsset } = vi.hoisted(() => ({
  cropImage: vi.fn(),
  uploadImageAsset: vi.fn(),
}));
vi.mock("@/lib/media/compose-image", () => ({ cropImage }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadImageAsset }));

import { imageCropNodeSchema } from "@/components/nodes/node-image-crop";
import type { ExecContext, StandardizedOutput } from "@/types/node";

const img = (url: string): StandardizedOutput => ({ type: "image", value: { url } });

function ctx(
  inputs: Record<string, StandardizedOutput | StandardizedOutput[] | undefined>,
  config: Record<string, unknown> = {},
): ExecContext {
  return {
    nodeId: "n1",
    config,
    inputs,
    signal: new AbortController().signal,
  } as ExecContext;
}

beforeEach(() => {
  cropImage.mockReset();
  uploadImageAsset.mockReset();
  cropImage.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  uploadImageAsset.mockResolvedValue({ url: "https://cdn/crop.png" });
});

describe("image-crop node", () => {
  it("throws when no image is wired", async () => {
    await expect(
      imageCropNodeSchema.execute!(ctx({}) as never),
    ).rejects.toThrow(/Wire an image/);
  });

  it("crops the input image to the configured rect", async () => {
    const result = await imageCropNodeSchema.execute!(
      ctx(
        { image: img("https://x/src.png") },
        { cropX: 0.1, cropY: 0.2, cropW: 0.5, cropH: 0.4 },
      ) as never,
    );
    expect(cropImage).toHaveBeenCalledWith("https://x/src.png", {
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.4,
    });
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("image");
  });

  it("defaults to the full image when no rect is set", async () => {
    await imageCropNodeSchema.execute!(
      ctx({ image: img("https://x/src.png") }) as never,
    );
    expect(cropImage).toHaveBeenCalledWith("https://x/src.png", {
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
});
