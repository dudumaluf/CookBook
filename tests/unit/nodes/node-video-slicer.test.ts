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

  it("requests exact windows by default (minTailMs 0 — never folds a tail UP past the window)", async () => {
    await videoSlicerNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/perf.mp4" } } },
        { windowSec: 12 },
      ) as Cfg,
    );
    // The reported bug: slicing a ~13s clip "to 12s" returned one 13s clip
    // because the 1s tail folded UP into window 1. Default minTailMs 0 keeps
    // windows ≤ windowSec, so the slice is genuinely 12s.
    expect(computeMediaWindows).toHaveBeenCalledWith({
      totalMs: 30000,
      windowMs: 12000,
      minTailMs: 0,
    });
  });

  it("trim mode hard-cuts to the first N seconds (single clip, never windows/folds)", async () => {
    sliceVideo.mockResolvedValue([new Blob(["a"], { type: "video/mp4" })]);
    const result = await videoSlicerNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/v.mp4" } } },
        { mode: "trim", windowSec: 12 },
      ) as Cfg,
    );
    // A single [0,12s) window built directly — computeMediaWindows (and its
    // tail-fold) is never consulted, so a 13s source can't come back as 13s.
    expect(computeMediaWindows).not.toHaveBeenCalled();
    expect(sliceVideo.mock.calls[0]![1]).toEqual([
      { index: 0, startMs: 0, endMs: 12000, durationMs: 12000 },
    ]);
    expect((result as { output: StandardizedOutput[] }).output).toHaveLength(1);
  });

  it("trim clamps the length to the source duration", async () => {
    sliceVideo.mockResolvedValue([new Blob(["a"], { type: "video/mp4" })]);
    await videoSlicerNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/v.mp4" } } },
        { mode: "trim", windowSec: 60 },
      ) as Cfg,
    );
    // probe = 30s; asking to trim to 60s clamps to the 30s source.
    expect(sliceVideo.mock.calls[0]![1]).toEqual([
      { index: 0, startMs: 0, endMs: 30000, durationMs: 30000 },
    ]);
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
    expect(sliceVideo.mock.calls[0]![2]).toEqual({ keepAudio: true, maxHeight: 720 });
  });

  it("keeps source resolution when downscale is 'source'", async () => {
    await videoSlicerNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/perf.mp4" } } },
        { maxHeight: "source" },
      ) as Cfg,
    );
    expect(sliceVideo.mock.calls[0]![2]).toEqual({ keepAudio: true });
  });

  it("keeps audio by default", async () => {
    await videoSlicerNodeSchema.execute!(
      ctx({ video: { type: "video", value: { url: "https://x/perf.mp4" } } }) as Cfg,
    );
    expect(sliceVideo.mock.calls[0]![2]).toMatchObject({ keepAudio: true });
  });

  it("drops audio when keepAudio is turned off", async () => {
    await videoSlicerNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/perf.mp4" } } },
        { keepAudio: false },
      ) as Cfg,
    );
    expect(sliceVideo.mock.calls[0]![2]).toEqual({ keepAudio: false, maxHeight: 720 });
  });
});

describe("video-slicer schema", () => {
  it("defaults to windows mode with minTailSec 0 (windows respect the requested length)", () => {
    expect(videoSlicerNodeSchema.defaultConfig?.mode).toBe("windows");
    expect(videoSlicerNodeSchema.defaultConfig?.minTailSec).toBe(0);
  });

  it("defaults keepAudio on and exposes a keep-audio toggle", () => {
    expect(videoSlicerNodeSchema.defaultConfig?.keepAudio).toBe(true);
    expect(videoSlicerNodeSchema.configParams?.keepAudio).toEqual({
      control: "toggle",
      label: "keep audio",
    });
  });

  it("exposes a view-only `index` input so a Number can drive the preview", () => {
    const index = videoSlicerNodeSchema.inputs.find((i) => i.id === "index");
    expect(index).toMatchObject({
      id: "index",
      dataType: "number",
      viewOnly: true,
    });
  });
});
