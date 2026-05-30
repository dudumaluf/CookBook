import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractFrame, uploadImageAsset } = vi.hoisted(() => ({
  extractFrame: vi.fn(),
  uploadImageAsset: vi.fn(),
}));
vi.mock("@/lib/media", () => ({ extractFrame }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadImageAsset }));

import { frameExtractNodeSchema } from "@/components/nodes/node-frame-extract";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof frameExtractNodeSchema.execute>>[0];

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
  extractFrame.mockReset();
  uploadImageAsset.mockReset();
  extractFrame.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
  uploadImageAsset.mockResolvedValue({ url: "https://cdn/frame.png" });
});

describe("frame-extract node execute", () => {
  it("throws when no video is wired", async () => {
    await expect(
      frameExtractNodeSchema.execute!(ctx({}) as Cfg),
    ).rejects.toThrow(/Wire a video/);
  });

  it("extracts the last frame by default and emits an image", async () => {
    const result = await frameExtractNodeSchema.execute!(
      ctx({ video: { type: "video", value: { url: "https://x/clip.mp4" } } }) as Cfg,
    );
    expect(extractFrame).toHaveBeenCalledWith("https://x/clip.mp4", "last");
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("image");
    if (out.type === "image") expect(out.value.url).toBe("https://cdn/frame.png");
  });

  it("honors the configured frame position", async () => {
    await frameExtractNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/clip.mp4" } } },
        { position: "first" },
      ) as Cfg,
    );
    expect(extractFrame).toHaveBeenCalledWith("https://x/clip.mp4", "first");
  });

  it("is a non-reactive transform node with an image output", () => {
    expect(frameExtractNodeSchema.kind).toBe("frame-extract");
    expect(frameExtractNodeSchema.reactive).toBe(false);
    expect(frameExtractNodeSchema.outputs[0]?.dataType).toBe("image");
  });
});
