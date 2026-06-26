import { beforeEach, describe, expect, it, vi } from "vitest";

const { resizeImage, uploadImageAsset } = vi.hoisted(() => ({
  resizeImage: vi.fn(),
  uploadImageAsset: vi.fn(),
}));
vi.mock("@/lib/media", () => ({ resizeImage }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadImageAsset }));

import { resizeImageNodeSchema } from "@/components/nodes/node-resize-image";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof resizeImageNodeSchema.execute>>[0];

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

const IMG = { type: "image", value: { url: "https://x/in.png" } } as const;

beforeEach(() => {
  resizeImage.mockReset();
  uploadImageAsset.mockReset();
  resizeImage.mockResolvedValue({
    blob: new Blob(["x"], { type: "image/png" }),
    width: 800,
    height: 600,
  });
  uploadImageAsset.mockResolvedValue({ url: "https://cdn/resized.png" });
});

describe("resize-image schema", () => {
  it("is a non-reactive transform: image → image", () => {
    expect(resizeImageNodeSchema.kind).toBe("resize-image");
    expect(resizeImageNodeSchema.category).toBe("transform");
    expect(resizeImageNodeSchema.reactive).toBe(false);
    expect(resizeImageNodeSchema.inputs[0]?.dataType).toBe("image");
    expect(resizeImageNodeSchema.outputs[0]?.dataType).toBe("image");
  });
});

describe("resize-image execute", () => {
  it("throws when no image is wired", async () => {
    await expect(
      resizeImageNodeSchema.execute!(ctx({}) as Cfg),
    ).rejects.toThrow(/Wire an image/);
  });

  it("forwards mode + size to resizeImage and emits an image ref with the result dims", async () => {
    const result = await resizeImageNodeSchema.execute!(
      ctx({ image: IMG }, { mode: "contain", width: 800, height: 600 }) as Cfg,
    );
    expect(resizeImage).toHaveBeenCalledWith("https://x/in.png", {
      mode: "contain",
      width: 800,
      height: 600,
      background: undefined,
    });
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("image");
    if (out.type === "image") {
      expect(out.value).toMatchObject({
        url: "https://cdn/resized.png",
        width: 800,
        height: 600,
      });
    }
  });

  it("forwards a Fit pad color (background) when set", async () => {
    await resizeImageNodeSchema.execute!(
      ctx(
        { image: IMG },
        { mode: "contain", width: 512, height: 512, background: "#000000" },
      ) as Cfg,
    );
    expect(resizeImage).toHaveBeenCalledWith(
      "https://x/in.png",
      expect.objectContaining({ background: "#000000" }),
    );
  });

  it("requires both axes for Fit / Fill / Stretch", async () => {
    await expect(
      resizeImageNodeSchema.execute!(
        ctx({ image: IMG }, { mode: "cover", width: 800, height: 0 }) as Cfg,
      ),
    ).rejects.toThrow(/both width and height/i);
    expect(resizeImage).not.toHaveBeenCalled();
  });

  it("requires at least one axis for Scale", async () => {
    await expect(
      resizeImageNodeSchema.execute!(
        ctx({ image: IMG }, { mode: "scale", width: 0, height: 0 }) as Cfg,
      ),
    ).rejects.toThrow(/width and\/or height/i);
  });

  it("allows a single-axis Scale request", async () => {
    await resizeImageNodeSchema.execute!(
      ctx({ image: IMG }, { mode: "scale", width: 1920, height: 0 }) as Cfg,
    );
    expect(resizeImage).toHaveBeenCalledWith(
      "https://x/in.png",
      expect.objectContaining({ mode: "scale", width: 1920, height: 0 }),
    );
  });
});
