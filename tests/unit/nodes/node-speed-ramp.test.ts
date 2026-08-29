import { beforeEach, describe, expect, it, vi } from "vitest";

const { remapVideo } = vi.hoisted(() => ({ remapVideo: vi.fn() }));
vi.mock("@/lib/media/remap-video", () => ({ remapVideo }));

const { uploadMediaAsset } = vi.hoisted(() => ({ uploadMediaAsset: vi.fn() }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { speedRampNodeSchema } from "@/components/nodes/node-speed-ramp";
import { defaultRemapKeys } from "@/lib/media/time-remap";
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
  remapVideo.mockReset();
  remapVideo.mockResolvedValue({
    blob: new Blob(["ramped"], { type: "video/mp4" }),
    durationMs: 5000,
    width: 1280,
    height: 720,
  });
  uploadMediaAsset.mockReset();
  uploadMediaAsset.mockResolvedValue({ url: "https://cdn/ramped.mp4" });
});

describe("speed-ramp node", () => {
  it("is a non-reactive transform: video → video", () => {
    expect(speedRampNodeSchema.kind).toBe("speed-ramp");
    expect(speedRampNodeSchema.category).toBe("transform");
    expect(speedRampNodeSchema.reactive).toBe(false);
    expect(speedRampNodeSchema.inputs[0]?.dataType).toBe("video");
    expect(speedRampNodeSchema.outputs[0]?.dataType).toBe("video");
  });

  it("throws when no video is wired", async () => {
    await expect(speedRampNodeSchema.execute!(ctx({}) as never)).rejects.toThrow(
      /video/,
    );
  });

  it("forwards the curve + duration + fps and uploads the MP4", async () => {
    const keys = defaultRemapKeys();
    const result = await speedRampNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/in.mp4" } } },
        { keys, durationSec: 8, fps: 24 },
      ) as never,
    );
    expect(remapVideo).toHaveBeenCalledWith("https://x/in.mp4", {
      keys,
      durationSec: 8,
      fps: 24,
    });
    expect(uploadMediaAsset).toHaveBeenCalledWith(expect.any(File), "videos");
    const out = (result as { output: StandardizedOutput }).output;
    expect(out).toEqual({
      type: "video",
      value: {
        url: "https://cdn/ramped.mp4",
        mime: "video/mp4",
        durationMs: 5000,
        width: 1280,
        height: 720,
      },
    });
  });

  it("omits duration when it is 0 so the encoder keeps the source length", async () => {
    await speedRampNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/in.mp4" } } },
        { durationSec: 0, fps: 30 },
      ) as never,
    );
    expect(remapVideo).toHaveBeenCalledWith("https://x/in.mp4", {
      keys: expect.any(Array),
      fps: 30,
    });
  });
});
