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

  it("first-frame mode sends the wired start frame as startImageUrl (image-to-video)", async () => {
    await seedanceVideoNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "she turns to camera" },
          start: { type: "image", value: { url: "https://x/start.png" } },
        },
        { mode: "first-frame" },
      ) as Cfg,
    );
    const arg = callSeedanceVideo.mock.calls[0]![0];
    expect(arg.startImageUrl).toBe("https://x/start.png");
    expect(arg.endImageUrl).toBeUndefined();
    // image-to-video must not carry reference arrays.
    expect(arg.imageUrls).toBeUndefined();
    expect(arg.videoUrls).toBeUndefined();
    expect(arg.audioUrls).toBeUndefined();
  });

  it("first-last mode sends start + end frames", async () => {
    await seedanceVideoNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "day to night" },
          start: { type: "image", value: { url: "https://x/day.png" } },
          end: { type: "image", value: { url: "https://x/night.png" } },
        },
        { mode: "first-last" },
      ) as Cfg,
    );
    const arg = callSeedanceVideo.mock.calls[0]![0];
    expect(arg.startImageUrl).toBe("https://x/day.png");
    expect(arg.endImageUrl).toBe("https://x/night.png");
  });

  it("image-to-video mode exposes start/(end) frame sockets via getInputs", () => {
    const ref = seedanceVideoNodeSchema.getInputs!({ mode: "reference" });
    expect(ref.map((h) => h.id)).toEqual(["prompt", "image", "video", "audio"]);
    const ff = seedanceVideoNodeSchema.getInputs!({ mode: "first-frame" });
    expect(ff.map((h) => h.id)).toEqual(["prompt", "start"]);
    const fl = seedanceVideoNodeSchema.getInputs!({ mode: "first-last" });
    expect(fl.map((h) => h.id)).toEqual(["prompt", "start", "end"]);
  });

  it("first-frame mode requires a start frame", async () => {
    await expect(
      seedanceVideoNodeSchema.execute!(
        ctx(
          { prompt: { type: "text", value: "x" } },
          { mode: "first-frame" },
        ) as Cfg,
      ),
    ).rejects.toThrow(/start frame/);
    expect(callSeedanceVideo).not.toHaveBeenCalled();
  });

  it("first-last mode requires an end frame", async () => {
    await expect(
      seedanceVideoNodeSchema.execute!(
        ctx(
          {
            prompt: { type: "text", value: "x" },
            start: { type: "image", value: { url: "https://x/only.png" } },
          },
          { mode: "first-last" },
        ) as Cfg,
      ),
    ).rejects.toThrow(/end frame/);
    expect(callSeedanceVideo).not.toHaveBeenCalled();
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
