import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractFrames, probeMedia, uploadImageAsset } = vi.hoisted(() => ({
  extractFrames: vi.fn(),
  probeMedia: vi.fn(),
  uploadImageAsset: vi.fn(),
}));
vi.mock("@/lib/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media")>();
  return { ...actual, extractFrames, probeMedia };
});
vi.mock("@/lib/library/upload-asset", () => ({ uploadImageAsset }));

import { framesExtractNodeSchema } from "@/components/nodes/node-frames-extract";
import type { ExecContext, StandardizedOutput } from "@/types/node";

const video = (url: string, durationMs?: number): StandardizedOutput => ({
  type: "video",
  value: { url, ...(durationMs ? { durationMs } : {}) },
});

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
  extractFrames.mockReset();
  probeMedia.mockReset();
  uploadImageAsset.mockReset();
  extractFrames.mockResolvedValue([
    new Blob(["a"], { type: "image/png" }),
    new Blob(["b"], { type: "image/png" }),
    new Blob(["c"], { type: "image/png" }),
  ]);
  uploadImageAsset.mockImplementation(async (file: File) => ({
    url: `https://cdn/${file.name}`,
    width: 1920,
    height: 1080,
  }));
  probeMedia.mockResolvedValue({ durationMs: 6000, hasVideo: true, hasAudio: false });
});

describe("frames-extract node", () => {
  it("throws when no video is wired", async () => {
    await expect(
      framesExtractNodeSchema.execute!(ctx({}) as never),
    ).rejects.toThrow(/Wire a video/);
  });

  it("outputs an array of image outputs (one per extracted frame)", async () => {
    const result = (await framesExtractNodeSchema.execute!(
      ctx(
        { video: video("https://x/clip.mp4", 6000) },
        { mode: "count", count: 3 },
      ) as never,
    )) as StandardizedOutput[];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result.every((o) => o.type === "image")).toBe(true);
    expect(uploadImageAsset).toHaveBeenCalledTimes(3);
  });

  it("propagates intrinsic dimensions onto each frame ref", async () => {
    const result = (await framesExtractNodeSchema.execute!(
      ctx({ video: video("https://x/clip.mp4", 6000) }, { count: 3 }) as never,
    )) as StandardizedOutput[];
    const first = result[0]!;
    expect(first.type).toBe("image");
    if (first.type === "image") {
      expect(first.value.width).toBe(1920);
      expect(first.value.height).toBe(1080);
    }
  });

  it("uses the upstream duration without probing when available", async () => {
    await framesExtractNodeSchema.execute!(
      ctx({ video: video("https://x/clip.mp4", 8000) }, { count: 2 }) as never,
    );
    expect(probeMedia).not.toHaveBeenCalled();
    // count=3 frames returned by the mock regardless; the key assertion is
    // that timestamps were computed against the 8000ms duration.
    const [, timestamps] = extractFrames.mock.calls[0]!;
    expect(Math.max(...(timestamps as number[]))).toBeLessThan(8000);
  });

  it("probes for duration when the upstream carries none", async () => {
    await framesExtractNodeSchema.execute!(
      ctx({ video: video("https://x/clip.mp4") }, { count: 2 }) as never,
    );
    expect(probeMedia).toHaveBeenCalledWith("https://x/clip.mp4");
  });

  it("passes interval-mode timestamps to extractFrames", async () => {
    await framesExtractNodeSchema.execute!(
      ctx(
        { video: video("https://x/clip.mp4", 5000) },
        { mode: "interval", intervalSec: 1 },
      ) as never,
    );
    const [url, timestamps] = extractFrames.mock.calls[0]!;
    expect(url).toBe("https://x/clip.mp4");
    expect(timestamps).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it("declares a multiple image output for array consumers", () => {
    const out = framesExtractNodeSchema.outputs[0]!;
    expect(out.dataType).toBe("image");
    expect(out.multiple).toBe(true);
  });
});
