import { beforeEach, describe, expect, it, vi } from "vitest";

const { probeMedia, computeMediaWindows, sliceVideo, uploadMediaAsset } =
  vi.hoisted(() => ({
    probeMedia: vi.fn(),
    computeMediaWindows: vi.fn(),
    sliceVideo: vi.fn(),
    uploadMediaAsset: vi.fn(),
  }));
vi.mock("@/lib/media", () => ({ probeMedia, computeMediaWindows, sliceVideo }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { videoSlicerNodeSchema } from "@/components/nodes/node-video-slicer";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof videoSlicerNodeSchema.execute>>[0];

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
  probeMedia.mockReset();
  computeMediaWindows.mockReset();
  sliceVideo.mockReset();
  uploadMediaAsset.mockReset();
  probeMedia.mockResolvedValue({ durationMs: 30000 });
  computeMediaWindows.mockReturnValue([
    { index: 0, startMs: 0, endMs: 15000, durationMs: 15000 },
    { index: 1, startMs: 15000, endMs: 30000, durationMs: 15000 },
  ]);
  sliceVideo.mockResolvedValue([
    new Blob(["a"], { type: "video/mp4" }),
    new Blob(["b"], { type: "video/mp4" }),
  ]);
  uploadMediaAsset.mockResolvedValue({ url: "https://cdn/chunk.mp4" });
});

describe("video-slicer node execute", () => {
  it("throws when no video is wired", async () => {
    await expect(
      videoSlicerNodeSchema.execute!(ctx({}) as Cfg),
    ).rejects.toThrow(/Wire a video/);
  });

  it("emits one video output per window, into the videos folder", async () => {
    const result = await videoSlicerNodeSchema.execute!(
      ctx({ video: { type: "video", value: { url: "https://x/perf.mp4" } } }) as Cfg,
    );
    const out = (result as { output: StandardizedOutput[] }).output;
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.type === "video")).toBe(true);
    expect(uploadMediaAsset).toHaveBeenCalledTimes(2);
    expect(uploadMediaAsset.mock.calls[0]![1]).toBe("videos");
  });

  it("downscales to the configured cap (720p default)", async () => {
    await videoSlicerNodeSchema.execute!(
      ctx({ video: { type: "video", value: { url: "https://x/perf.mp4" } } }) as Cfg,
    );
    expect(sliceVideo.mock.calls[0]![2]).toEqual({ maxHeight: 720 });
  });

  it("keeps source resolution when downscale is 'source'", async () => {
    await videoSlicerNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/perf.mp4" } } },
        { maxHeight: "source" },
      ) as Cfg,
    );
    expect(sliceVideo.mock.calls[0]![2]).toEqual({});
  });
});
