import { beforeEach, describe, expect, it, vi } from "vitest";

const { resizeVideo, uploadMediaAsset } = vi.hoisted(() => ({
  resizeVideo: vi.fn(),
  uploadMediaAsset: vi.fn(),
}));
vi.mock("@/lib/media", () => ({ resizeVideo }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { resizeVideoNodeSchema } from "@/components/nodes/node-resize-video";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof resizeVideoNodeSchema.execute>>[0];

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
  resizeVideo.mockReset();
  uploadMediaAsset.mockReset();
  resizeVideo.mockResolvedValue({
    blob: new Blob(["x"], { type: "video/mp4" }),
    width: 1280,
    height: 720,
  });
  uploadMediaAsset.mockResolvedValue({ url: "https://cdn/resized.mp4" });
});

describe("resize-video schema", () => {
  it("is a non-reactive transform: video → video", () => {
    expect(resizeVideoNodeSchema.kind).toBe("resize-video");
    expect(resizeVideoNodeSchema.category).toBe("transform");
    expect(resizeVideoNodeSchema.reactive).toBe(false);
    expect(resizeVideoNodeSchema.inputs[0]?.dataType).toBe("video");
    expect(resizeVideoNodeSchema.outputs[0]?.dataType).toBe("video");
  });
});

describe("resize-video execute", () => {
  it("throws when no video is wired", async () => {
    await expect(
      resizeVideoNodeSchema.execute!(ctx({}) as Cfg),
    ).rejects.toThrow(/Wire a video/);
  });

  it("forwards mode + size to resizeVideo and uploads to the videos folder", async () => {
    const result = await resizeVideoNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/in.mp4" } } },
        { mode: "contain", width: 1280, height: 720 },
      ) as Cfg,
    );
    expect(resizeVideo).toHaveBeenCalledWith("https://x/in.mp4", {
      mode: "contain",
      width: 1280,
      height: 720,
    });
    expect(uploadMediaAsset).toHaveBeenCalledWith(expect.any(File), "videos");
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value).toMatchObject({
        url: "https://cdn/resized.mp4",
        width: 1280,
        height: 720,
      });
    }
  });

  it("carries the source durationMs through (resize doesn't change length)", async () => {
    const result = await resizeVideoNodeSchema.execute!(
      ctx(
        {
          video: {
            type: "video",
            value: { url: "https://x/in.mp4", durationMs: 5000 },
          },
        },
        { mode: "scale", width: 640, height: 0 },
      ) as Cfg,
    );
    const out = (result as { output: StandardizedOutput }).output;
    if (out.type === "video") expect(out.value.durationMs).toBe(5000);
  });

  it("requires both axes for Fit / Fill / Stretch", async () => {
    await expect(
      resizeVideoNodeSchema.execute!(
        ctx(
          { video: { type: "video", value: { url: "https://x/in.mp4" } } },
          { mode: "stretch", width: 0, height: 720 },
        ) as Cfg,
      ),
    ).rejects.toThrow(/both width and height/i);
    expect(resizeVideo).not.toHaveBeenCalled();
  });
});
