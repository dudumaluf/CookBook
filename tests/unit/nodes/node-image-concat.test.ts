import { beforeEach, describe, expect, it, vi } from "vitest";

const { concatImages, uploadImageAsset } = vi.hoisted(() => ({
  concatImages: vi.fn(),
  uploadImageAsset: vi.fn(),
}));
vi.mock("@/lib/media/compose-image", () => ({ concatImages }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadImageAsset }));

import { imageConcatNodeSchema } from "@/components/nodes/node-image-concat";
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
  concatImages.mockReset();
  uploadImageAsset.mockReset();
  concatImages.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  uploadImageAsset.mockResolvedValue({ url: "https://cdn/concat.png" });
});

describe("image-concat node", () => {
  it("throws when no images are wired", async () => {
    await expect(
      imageConcatNodeSchema.execute!(ctx({}) as never),
    ).rejects.toThrow(/Wire one or more images/);
  });

  it("joins ordered img-N sockets in order with direction + fit", async () => {
    const result = await imageConcatNodeSchema.execute!(
      ctx(
        {
          "img-0": img("https://x/a.png"),
          "img-1": img("https://x/b.png"),
        },
        { direction: "column", fit: "max", portCount: 2 },
      ) as never,
    );
    expect(concatImages).toHaveBeenCalledWith(
      ["https://x/a.png", "https://x/b.png"],
      expect.objectContaining({ direction: "column", fit: "max" }),
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("image");
  });

  it("passes a single image through without compositing", async () => {
    const out = (await imageConcatNodeSchema.execute!(
      ctx({ "img-0": img("https://x/only.png") }) as never,
    )) as StandardizedOutput;
    expect(out).toEqual(img("https://x/only.png"));
    expect(concatImages).not.toHaveBeenCalled();
  });

  it("grows the socket list with portCount", () => {
    expect(imageConcatNodeSchema.getInputs!({}).map((h) => h.id)).toEqual([
      "img-0",
      "img-1",
    ]);
    expect(
      imageConcatNodeSchema.getInputs!({ portCount: 3 }).map((h) => h.id),
    ).toEqual(["img-0", "img-1", "img-2"]);
  });
});
