import { beforeEach, describe, expect, it, vi } from "vitest";

const { callSeedanceVideo } = vi.hoisted(() => ({
  callSeedanceVideo: vi.fn(),
}));
vi.mock("@/lib/fal/call-seedance", () => ({
  callSeedanceVideo,
  FalCallError: class extends Error {},
}));

import { seedanceVideoNodeSchema } from "@/components/nodes/node-fal-seedance";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof seedanceVideoNodeSchema.execute>>[0];

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
  callSeedanceVideo.mockReset();
  callSeedanceVideo.mockResolvedValue({
    videoUrl: "https://cdn.fal.media/clip.mp4",
    mime: "video/mp4",
    model: "bytedance/seedance-2.0/text-to-video",
  });
});

describe("seedance-video node execute", () => {
  it("throws when neither prompt nor refs are wired", async () => {
    await expect(
      seedanceVideoNodeSchema.execute!(ctx({}) as Cfg),
    ).rejects.toThrow(/Nothing to generate/);
  });

  it("generates from a prompt and emits a video output", async () => {
    const result = await seedanceVideoNodeSchema.execute!(
      ctx({ prompt: { type: "text", value: "an octopus" } }) as Cfg,
    );
    expect(callSeedanceVideo).toHaveBeenCalledTimes(1);
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://cdn.fal.media/clip.mp4");
    }
  });

  it("forwards image/video/audio reference arrays", async () => {
    await seedanceVideoNodeSchema.execute!(
      ctx({
        prompt: { type: "text", value: "perform" },
        image: [{ type: "image", value: { url: "https://x/face.png" } }],
        video: [{ type: "video", value: { url: "https://x/prev.mp4" } }],
        audio: [{ type: "audio", value: { url: "https://x/slice.mp3" } }],
      }) as Cfg,
    );
    const arg = callSeedanceVideo.mock.calls[0]![0];
    expect(arg.imageUrls).toEqual(["https://x/face.png"]);
    expect(arg.videoUrls).toEqual(["https://x/prev.mp4"]);
    expect(arg.audioUrls).toEqual(["https://x/slice.mp3"]);
  });

  it("rejects an out-of-range duration before calling the API", async () => {
    await expect(
      seedanceVideoNodeSchema.execute!(
        ctx(
          { prompt: { type: "text", value: "x" } },
          { duration: 30 },
        ) as Cfg,
      ),
    ).rejects.toThrow(/Duration/);
    expect(callSeedanceVideo).not.toHaveBeenCalled();
  });

  it("is registered as a non-reactive ai-video node", () => {
    expect(seedanceVideoNodeSchema.kind).toBe("seedance-video");
    expect(seedanceVideoNodeSchema.category).toBe("ai-video");
    expect(seedanceVideoNodeSchema.reactive).toBe(false);
    expect(seedanceVideoNodeSchema.outputs[0]?.dataType).toBe("video");
  });
});
