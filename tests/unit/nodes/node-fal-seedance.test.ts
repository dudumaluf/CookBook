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

  it("forwards numbered reference sockets in order (image-0, image-1, …)", async () => {
    await seedanceVideoNodeSchema.execute!(
      ctx({
        prompt: { type: "text", value: "perform" },
        "image-0": { type: "image", value: { url: "https://x/face.png" } },
        "image-1": { type: "image", value: { url: "https://x/frame.png" } },
        "video-0": { type: "video", value: { url: "https://x/prev.mp4" } },
        "audio-0": { type: "audio", value: { url: "https://x/slice.mp3" } },
      }) as Cfg,
    );
    const arg = callSeedanceVideo.mock.calls[0]![0];
    expect(arg.imageUrls).toEqual(["https://x/face.png", "https://x/frame.png"]);
    expect(arg.videoUrls).toEqual(["https://x/prev.mp4"]);
    expect(arg.audioUrls).toEqual(["https://x/slice.mp3"]);
  });

  it("rewrites @friendlyName in the prompt to the Fal positional token", async () => {
    await seedanceVideoNodeSchema.execute!(
      ctx(
        {
          prompt: {
            type: "text",
            value: "Put @character into @performance, singing @song",
          },
          "image-0": { type: "image", value: { url: "https://x/char.png" } },
          "video-0": { type: "video", value: { url: "https://x/perf.mp4" } },
          "audio-0": { type: "audio", value: { url: "https://x/song.mp3" } },
        },
        {
          refNames: {
            "image-0": "character",
            "video-0": "performance",
            "audio-0": "song",
          },
        },
      ) as Cfg,
    );
    const arg = callSeedanceVideo.mock.calls[0]![0];
    expect(arg.prompt).toBe("Put @Image1 into @Video1, singing @Audio1");
  });

  it("still accepts the legacy image/video/audio multi-handles", async () => {
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

  it("reference mode exposes auto-growing per-type sockets up to the Fal caps", () => {
    const ref = seedanceVideoNodeSchema.getInputs!({ mode: "reference" });
    expect(ref.map((h) => h.id)).toEqual([
      "prompt",
      "image-0",
      "image",
      "video-0",
      "audio-0",
    ]);
    const grown = seedanceVideoNodeSchema.getInputs!({
      mode: "reference",
      imagePorts: 3,
      videoPorts: 2,
      audioPorts: 1,
    });
    expect(grown.map((h) => h.id)).toEqual([
      "prompt",
      "image-0",
      "image-1",
      "image-2",
      "image",
      "video-0",
      "video-1",
      "audio-0",
    ]);
    // Caps clamp: asking for more than 9 images yields exactly 9 numbered
    // sockets (the `image` array socket has no dash, so it's excluded here).
    const capped = seedanceVideoNodeSchema.getInputs!({
      mode: "reference",
      imagePorts: 99,
    });
    expect(capped.filter((h) => h.id.startsWith("image-")).length).toBe(9);
  });

  it("exposes a single multiple image-array socket (@Image[]) in reference mode", () => {
    const ref = seedanceVideoNodeSchema.getInputs!({ mode: "reference" });
    const arraySockets = ref.filter((h) => h.id === "image");
    expect(arraySockets.length).toBe(1);
    expect(arraySockets[0]?.multiple).toBe(true);
    expect(arraySockets[0]?.label).toBe("@Image[]");
    expect(arraySockets[0]?.dataType).toBe("image");
    // The array socket is image-only — no bare `video`/`audio` array sockets.
    expect(ref.some((h) => h.id === "video")).toBe(false);
    expect(ref.some((h) => h.id === "audio")).toBe(false);
  });

  it("fans an image array wired into @Image[] into @Image1..N, after numbered sockets", async () => {
    await seedanceVideoNodeSchema.execute!(
      ctx({
        prompt: { type: "text", value: "transition through @Image1..@Image3" },
        "image-0": { type: "image", value: { url: "https://x/face.png" } },
        image: [
          { type: "image", value: { url: "https://x/k1.png" } },
          { type: "image", value: { url: "https://x/k2.png" } },
        ],
      }) as Cfg,
    );
    const arg = callSeedanceVideo.mock.calls[0]![0];
    // Individually-wired socket first, then the array elements in order.
    expect(arg.imageUrls).toEqual([
      "https://x/face.png",
      "https://x/k1.png",
      "https://x/k2.png",
    ]);
  });

  it("labels each reference socket with its Fal prompt token (@Image1, …)", () => {
    const ref = seedanceVideoNodeSchema.getInputs!({
      mode: "reference",
      imagePorts: 2,
      videoPorts: 1,
      audioPorts: 1,
    });
    const byId = Object.fromEntries(ref.map((h) => [h.id, h.label]));
    expect(byId["image-0"]).toBe("@Image1");
    expect(byId["image-1"]).toBe("@Image2");
    expect(byId["video-0"]).toBe("@Video1");
    expect(byId["audio-0"]).toBe("@Audio1");
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
    expect(ref.map((h) => h.id)).toEqual([
      "prompt",
      "image-0",
      "image",
      "video-0",
      "audio-0",
    ]);
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
