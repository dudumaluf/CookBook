import { beforeEach, describe, expect, it, vi } from "vitest";

const { padVideoToMinDuration, uploadMediaAsset } = vi.hoisted(() => ({
  padVideoToMinDuration: vi.fn(),
  uploadMediaAsset: vi.fn(),
}));
vi.mock("@/lib/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media")>();
  return { ...actual, padVideoToMinDuration };
});
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { videoPadNodeSchema } from "@/components/nodes/node-video-pad";
import { splitPadDuration } from "@/lib/media";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof videoPadNodeSchema.execute>>[0];

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
  padVideoToMinDuration.mockReset();
  uploadMediaAsset.mockReset();
  uploadMediaAsset.mockResolvedValue({ url: "https://cdn/padded.mp4" });
});

describe("splitPadDuration", () => {
  it("returns zeros when source already meets the minimum", () => {
    expect(splitPadDuration(5000, 4000, "end")).toEqual({
      padStartMs: 0,
      padEndMs: 0,
    });
    expect(splitPadDuration(4000, 4000, "both")).toEqual({
      padStartMs: 0,
      padEndMs: 0,
    });
  });

  it("puts the whole deficit at the end for `end` mode", () => {
    expect(splitPadDuration(2000, 4000, "end")).toEqual({
      padStartMs: 0,
      padEndMs: 2000,
    });
  });

  it("puts the whole deficit at the start for `start` mode", () => {
    expect(splitPadDuration(2000, 4000, "start")).toEqual({
      padStartMs: 2000,
      padEndMs: 0,
    });
  });

  it("splits evenly for `both`, biasing the odd millisecond to the end", () => {
    expect(splitPadDuration(2000, 4001, "both")).toEqual({
      padStartMs: 1000,
      padEndMs: 1001,
    });
    expect(splitPadDuration(0, 1000, "both")).toEqual({
      padStartMs: 500,
      padEndMs: 500,
    });
  });
});

describe("video-pad node execute", () => {
  it("throws when no video is wired", async () => {
    await expect(
      videoPadNodeSchema.execute!(ctx({}) as Cfg),
    ).rejects.toThrow(/Wire a video/);
  });

  it("uploads and emits the padded MP4 when source is below the floor", async () => {
    padVideoToMinDuration.mockResolvedValue({
      blob: new Blob(["mp4"], { type: "video/mp4" }),
      sourceDurationMs: 2000,
      paddedDurationMs: 4000,
      padStartMs: 0,
      padEndMs: 2000,
    });
    const result = await videoPadNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/short.mp4" } } },
        { minDurationSec: 4, padMode: "end" },
      ) as Cfg,
    );
    expect(padVideoToMinDuration).toHaveBeenCalledWith("https://x/short.mp4", {
      minDurationSec: 4,
      padMode: "end",
    });
    expect(uploadMediaAsset).toHaveBeenCalledTimes(1);
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://cdn/padded.mp4");
      expect(out.value.durationMs).toBe(4000);
      expect(out.value.mime).toBe("video/mp4");
    }
  });

  it("passes the source URL through when it already meets the minimum", async () => {
    padVideoToMinDuration.mockResolvedValue({
      blob: null,
      sourceDurationMs: 6000,
      paddedDurationMs: 6000,
      padStartMs: 0,
      padEndMs: 0,
    });
    const result = await videoPadNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/long.mp4" } } },
        { minDurationSec: 4, padMode: "end" },
      ) as Cfg,
    );
    expect(uploadMediaAsset).not.toHaveBeenCalled();
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://x/long.mp4");
      expect(out.value.durationMs).toBe(6000);
    }
  });

  it("treats minDurationSec <= 0 as a passthrough (no helper call)", async () => {
    const result = await videoPadNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/clip.mp4" } } },
        { minDurationSec: 0, padMode: "end" },
      ) as Cfg,
    );
    expect(padVideoToMinDuration).not.toHaveBeenCalled();
    expect(uploadMediaAsset).not.toHaveBeenCalled();
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") expect(out.value.url).toBe("https://x/clip.mp4");
  });

  it("forwards the configured pad mode to the helper", async () => {
    padVideoToMinDuration.mockResolvedValue({
      blob: new Blob(["mp4"], { type: "video/mp4" }),
      sourceDurationMs: 1000,
      paddedDurationMs: 4000,
      padStartMs: 1500,
      padEndMs: 1500,
    });
    await videoPadNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/tiny.mp4" } } },
        { minDurationSec: 4, padMode: "both" },
      ) as Cfg,
    );
    expect(padVideoToMinDuration).toHaveBeenCalledWith("https://x/tiny.mp4", {
      minDurationSec: 4,
      padMode: "both",
    });
  });

  it("uses sane defaults when config keys are absent", async () => {
    padVideoToMinDuration.mockResolvedValue({
      blob: null,
      sourceDurationMs: 5000,
      paddedDurationMs: 5000,
      padStartMs: 0,
      padEndMs: 0,
    });
    await videoPadNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/clip.mp4" } } },
        // no config — schema defaults apply
        {},
      ) as Cfg,
    );
    expect(padVideoToMinDuration).toHaveBeenCalledWith("https://x/clip.mp4", {
      minDurationSec: 4,
      padMode: "end",
    });
  });

  it("is a non-reactive transform node with a single video output", () => {
    expect(videoPadNodeSchema.kind).toBe("video-pad");
    expect(videoPadNodeSchema.category).toBe("transform");
    expect(videoPadNodeSchema.reactive).toBe(false);
    expect(videoPadNodeSchema.inputs).toHaveLength(1);
    expect(videoPadNodeSchema.inputs[0]?.dataType).toBe("video");
    expect(videoPadNodeSchema.outputs).toHaveLength(1);
    expect(videoPadNodeSchema.outputs[0]?.dataType).toBe("video");
    expect(videoPadNodeSchema.defaultConfig).toEqual({
      minDurationSec: 4,
      padMode: "end",
    });
  });
});
