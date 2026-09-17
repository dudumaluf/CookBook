import { beforeEach, describe, expect, it, vi } from "vitest";

const { cutVideo } = vi.hoisted(() => ({ cutVideo: vi.fn() }));
vi.mock("@/lib/media/cut-video", () => ({ cutVideo }));

const { uploadMediaAsset } = vi.hoisted(() => ({ uploadMediaAsset: vi.fn() }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { videoCutNodeSchema } from "@/components/nodes/node-video-cut";
import { defaultCutPins } from "@/lib/media/cut-pins";
import type { ExecContext, StandardizedOutput } from "@/types/node";

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
  cutVideo.mockReset();
  cutVideo.mockResolvedValue({
    blob: new Blob(["cut"], { type: "video/mp4" }),
    durationMs: 4000,
    width: 1280,
    height: 720,
  });
  uploadMediaAsset.mockReset();
  uploadMediaAsset.mockResolvedValue({ url: "https://cdn/cut.mp4" });
});

describe("video-cut node", () => {
  it("is a non-reactive transform: video → video", () => {
    expect(videoCutNodeSchema.kind).toBe("video-cut");
    expect(videoCutNodeSchema.category).toBe("transform");
    expect(videoCutNodeSchema.reactive).toBe(false);
    expect(videoCutNodeSchema.inputs[0]?.dataType).toBe("video");
    expect(videoCutNodeSchema.outputs[0]?.dataType).toBe("video");
  });

  it("throws when no video is wired", async () => {
    await expect(videoCutNodeSchema.execute!(ctx({}) as never)).rejects.toThrow(
      /video/,
    );
  });

  it("throws when every zone is cut out", async () => {
    await expect(
      videoCutNodeSchema.execute!(
        ctx(
          {
            video: {
              type: "video",
              value: { url: "https://x/in.mp4", durationMs: 8000 },
            },
          },
          { pins: [{ srcSec: 0, keep: false }] },
        ) as never,
      ),
    ).rejects.toThrow(/Keep at least one zone/);
    expect(cutVideo).not.toHaveBeenCalled();
  });

  it("passes the source through when nothing is cut", async () => {
    const result = await videoCutNodeSchema.execute!(
      ctx(
        {
          video: {
            type: "video",
            value: {
              url: "https://x/in.mp4",
              mime: "video/mp4",
              durationMs: 8000,
              width: 1920,
              height: 1080,
            },
          },
        },
        { pins: defaultCutPins(), fps: 30 },
      ) as never,
    );
    expect(cutVideo).not.toHaveBeenCalled();
    expect(uploadMediaAsset).not.toHaveBeenCalled();
    const out = (result as { output: StandardizedOutput }).output;
    expect(out).toEqual({
      type: "video",
      value: {
        url: "https://x/in.mp4",
        mime: "video/mp4",
        durationMs: 8000,
        width: 1920,
        height: 1080,
      },
    });
  });

  it("encodes and uploads when a zone is cut out", async () => {
    const pins = [
      { srcSec: 0, keep: true },
      { srcSec: 2, keep: false },
      { srcSec: 4, keep: true },
    ];
    const result = await videoCutNodeSchema.execute!(
      ctx(
        {
          video: {
            type: "video",
            value: { url: "https://x/in.mp4", durationMs: 8000 },
          },
        },
        { pins, fps: 24 },
      ) as never,
    );
    expect(cutVideo).toHaveBeenCalledWith("https://x/in.mp4", pins, 24);
    expect(uploadMediaAsset).toHaveBeenCalledWith(expect.any(File), "videos");
    const out = (result as { output: StandardizedOutput }).output;
    expect(out).toEqual({
      type: "video",
      value: {
        url: "https://cdn/cut.mp4",
        mime: "video/mp4",
        durationMs: 4000,
        width: 1280,
        height: 720,
      },
    });
  });

  it("defaults to a single keep pin", () => {
    expect(videoCutNodeSchema.defaultConfig.pins).toEqual(defaultCutPins());
  });
});
