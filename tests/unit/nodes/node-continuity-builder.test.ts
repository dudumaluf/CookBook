import { beforeEach, describe, expect, it, vi } from "vitest";

const { callSeedanceVideo } = vi.hoisted(() => ({
  callSeedanceVideo: vi.fn(),
}));
vi.mock("@/lib/fal/call-seedance", () => ({
  callSeedanceVideo,
  FalCallError: class extends Error {},
}));

const { sliceAudio, sliceVideo, extractFrame, probeMedia } = vi.hoisted(() => ({
  sliceAudio: vi.fn(),
  sliceVideo: vi.fn(),
  extractFrame: vi.fn(),
  probeMedia: vi.fn(),
}));
vi.mock("@/lib/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media")>();
  return { ...actual, sliceAudio, sliceVideo, extractFrame, probeMedia };
});

const { uploadImageAsset, uploadMediaAsset } = vi.hoisted(() => ({
  uploadImageAsset: vi.fn(),
  uploadMediaAsset: vi.fn(),
}));
vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset,
  uploadMediaAsset,
}));

import { continuityBuilderNodeSchema } from "@/components/nodes/node-continuity-builder";
import type { ExecContext, ExecProgress, StandardizedOutput } from "@/types/node";

let clipCounter = 0;

function ctx(
  inputs: Record<string, StandardizedOutput | StandardizedOutput[] | undefined>,
  config: Record<string, unknown> = {},
  signal = new AbortController().signal,
  onProgress?: (p: ExecProgress) => void,
): ExecContext {
  return {
    nodeId: "n1",
    config,
    inputs,
    signal,
    reportProgress: onProgress,
  } as ExecContext;
}

beforeEach(() => {
  clipCounter = 0;
  callSeedanceVideo.mockReset();
  callSeedanceVideo.mockImplementation(async () => ({
    videoUrl: `https://cdn.fal.media/clip-${++clipCounter}.mp4`,
    mime: "video/mp4",
    model: "bytedance/seedance-2.0/reference-to-video",
  }));
  sliceAudio.mockReset();
  sliceVideo.mockReset();
  extractFrame.mockReset();
  extractFrame.mockResolvedValue(new Blob(["frame"], { type: "image/png" }));
  probeMedia.mockReset();
  uploadImageAsset.mockReset();
  uploadImageAsset.mockResolvedValue({ url: "https://supabase.test/frame.png" });
  uploadMediaAsset.mockReset();
  uploadMediaAsset.mockResolvedValue({ url: "https://supabase.test/slice.wav" });
});

describe("Continuity Builder — extension strategy", () => {
  it("loops chunkCount times, carrying the previous clip forward as @Video1", async () => {
    const result = await continuityBuilderNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "perform on stage" },
          image: { type: "image", value: { url: "https://x/face.png" } },
        },
        { strategy: "extension", chunkCount: 3 },
      ) as never,
    );

    expect(callSeedanceVideo).toHaveBeenCalledTimes(3);
    // Chunk 1: no prev video, seeded by the character image.
    const call1 = callSeedanceVideo.mock.calls[0]![0];
    expect(call1.imageUrls).toEqual(["https://x/face.png"]);
    expect(call1.videoUrls).toBeUndefined();
    // Chunk 2: prev clip fed as @Video1 (state carried forward).
    const call2 = callSeedanceVideo.mock.calls[1]![0];
    expect(call2.videoUrls).toEqual(["https://cdn.fal.media/clip-1.mp4"]);
    // Chunk 3: prev = clip-2.
    const call3 = callSeedanceVideo.mock.calls[2]![0];
    expect(call3.videoUrls).toEqual(["https://cdn.fal.media/clip-2.mp4"]);

    const out = (result as { output: StandardizedOutput[] }).output;
    expect(out).toHaveLength(3);
    expect(out.every((o) => o.type === "video")).toBe(true);
  });

  it("reports per-chunk progress via reportProgress", async () => {
    const events: ExecProgress[] = [];
    await continuityBuilderNodeSchema.execute!(
      ctx(
        { prompt: { type: "text", value: "x" } },
        { chunkCount: 2 },
        new AbortController().signal,
        (p) => events.push(p),
      ) as never,
    );
    // At least: before chunk0, before chunk1, final.
    const totals = events.map((e) => e.fanOut?.done);
    expect(totals).toContain(0);
    expect(totals).toContain(2);
  });
});

describe("Continuity Builder — frame-chain strategy", () => {
  it("extracts the last frame between chunks and seeds the next via @Image1", async () => {
    const result = await continuityBuilderNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "x" },
          image: { type: "image", value: { url: "https://x/face.png" } },
        },
        { strategy: "frame-chain", chunkCount: 2 },
      ) as never,
    );
    // One extraction between the 2 chunks.
    expect(extractFrame).toHaveBeenCalledTimes(1);
    expect(extractFrame).toHaveBeenCalledWith(
      "https://cdn.fal.media/clip-1.mp4",
      "last",
    );
    // Chunk 2 seeded by the extracted+uploaded frame, no prev video.
    const call2 = callSeedanceVideo.mock.calls[1]![0];
    expect(call2.imageUrls).toEqual(["https://supabase.test/frame.png"]);
    expect(call2.videoUrls).toBeUndefined();
    expect((result as { output: StandardizedOutput[] }).output).toHaveLength(2);
  });
});

describe("Continuity Builder — audio windowing", () => {
  it("derives chunk count from the song and slices per-chunk audio", async () => {
    probeMedia.mockResolvedValue({ durationMs: 32000, hasVideo: false, hasAudio: true });
    sliceAudio.mockResolvedValue([
      new Blob(["a"], { type: "audio/wav" }),
      new Blob(["b"], { type: "audio/wav" }),
      new Blob(["c"], { type: "audio/wav" }),
    ]);
    await continuityBuilderNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "sing" },
          audio: { type: "audio", value: { url: "https://x/song.mp3" } },
        },
        { durationSec: 15 },
      ) as never,
    );
    // 32s / 15s -> 3 windows (15, 15, 2 -> tail folds? minTail 2000 keeps the 2s).
    expect(probeMedia).toHaveBeenCalledWith("https://x/song.mp3");
    expect(sliceAudio).toHaveBeenCalledTimes(1);
    // Each chunk gets its audio slice url.
    const call1 = callSeedanceVideo.mock.calls[0]![0];
    expect(call1.audioUrls).toEqual(["https://supabase.test/slice.wav"]);
  });
});

describe("Continuity Builder — reference performance video", () => {
  it("slices the reference video to the same windows and feeds it as @Video1 per chunk", async () => {
    probeMedia.mockResolvedValue({
      durationMs: 30000,
      hasVideo: true,
      hasAudio: true,
    });
    sliceAudio.mockResolvedValue([
      new Blob(["a"], { type: "audio/wav" }),
      new Blob(["b"], { type: "audio/wav" }),
    ]);
    sliceVideo.mockResolvedValue([
      new Blob(["v1"], { type: "video/mp4" }),
      new Blob(["v2"], { type: "video/mp4" }),
    ]);
    uploadMediaAsset.mockImplementation(
      async (_file: File, folder: "videos" | "audio") => ({
        url:
          folder === "videos"
            ? "https://supabase.test/ref.mp4"
            : "https://supabase.test/slice.wav",
      }),
    );

    await continuityBuilderNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "mirror the performance" },
          image: { type: "image", value: { url: "https://x/face.png" } },
          audio: { type: "audio", value: { url: "https://x/song.mp3" } },
          video: { type: "video", value: { url: "https://x/perf.mp4" } },
        },
        { strategy: "extension", durationSec: 15 },
      ) as never,
    );

    expect(sliceVideo).toHaveBeenCalledTimes(1);
    // Slices are downscaled to the reference cap (default 720p).
    expect(sliceVideo).toHaveBeenCalledWith(
      "https://x/perf.mp4",
      expect.any(Array),
      { maxHeight: 720 },
    );
    // Chunk 1: only the reference slice in video_urls (respects the 15s
    // combined-video cap); identity via the character image.
    const call1 = callSeedanceVideo.mock.calls[0]![0];
    expect(call1.videoUrls).toEqual(["https://supabase.test/ref.mp4"]);
    expect(call1.imageUrls).toEqual(["https://x/face.png"]);
    expect(call1.audioUrls).toEqual(["https://supabase.test/slice.wav"]);
    // A last frame is extracted for continuity (not a 15s previous clip).
    expect(extractFrame).toHaveBeenCalledWith(
      "https://cdn.fal.media/clip-1.mp4",
      "last",
    );
    // Chunk 2: still only the reference slice as video; continuity is the
    // previous last frame, added as a second IMAGE ref (not video).
    const call2 = callSeedanceVideo.mock.calls[1]![0];
    expect(call2.videoUrls).toEqual(["https://supabase.test/ref.mp4"]);
    expect(call2.imageUrls).toEqual([
      "https://x/face.png",
      "https://supabase.test/frame.png",
    ]);
  });
});

describe("Continuity Builder — safety", () => {
  it("aborts the loop between chunks when the signal fires", async () => {
    const controller = new AbortController();
    callSeedanceVideo.mockImplementation(async () => {
      controller.abort(); // abort after the first chunk
      return {
        videoUrl: `https://cdn.fal.media/clip-${++clipCounter}.mp4`,
        mime: "video/mp4",
        model: "m",
      };
    });
    await expect(
      continuityBuilderNodeSchema.execute!(
        ctx(
          { prompt: { type: "text", value: "x" } },
          { chunkCount: 5 },
          controller.signal,
        ) as never,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    // Only the first chunk ran before the abort was detected.
    expect(callSeedanceVideo).toHaveBeenCalledTimes(1);
  });

  it("caps chunks at maxChunks", async () => {
    await continuityBuilderNodeSchema.execute!(
      ctx(
        { prompt: { type: "text", value: "x" } },
        { chunkCount: 100, maxChunks: 3 },
      ) as never,
    );
    expect(callSeedanceVideo).toHaveBeenCalledTimes(3);
  });

  it("is registered as a non-reactive ai-video node outputting video", () => {
    expect(continuityBuilderNodeSchema.kind).toBe("continuity-builder");
    expect(continuityBuilderNodeSchema.category).toBe("ai-video");
    expect(continuityBuilderNodeSchema.reactive).toBe(false);
    expect(continuityBuilderNodeSchema.outputs[0]?.dataType).toBe("video");
  });
});
