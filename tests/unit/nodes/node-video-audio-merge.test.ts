import { beforeEach, describe, expect, it, vi } from "vitest";

const { replaceVideoAudio, uploadMediaAsset } = vi.hoisted(() => ({
  replaceVideoAudio: vi.fn(),
  uploadMediaAsset: vi.fn(),
}));
vi.mock("@/lib/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media")>();
  return { ...actual, replaceVideoAudio };
});
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { videoAudioMergeNodeSchema } from "@/components/nodes/node-video-audio-merge";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof videoAudioMergeNodeSchema.execute>>[0];

function ctx(
  inputs: Record<string, StandardizedOutput | StandardizedOutput[] | undefined>,
): ExecContext {
  return {
    nodeId: "n1",
    config: {},
    inputs,
    signal: new AbortController().signal,
  } as ExecContext;
}

beforeEach(() => {
  replaceVideoAudio.mockReset();
  uploadMediaAsset.mockReset();
  replaceVideoAudio.mockResolvedValue(new Blob(["mp4"], { type: "video/mp4" }));
  uploadMediaAsset.mockResolvedValue({ url: "https://cdn/merged.mp4" });
});

describe("video-audio-merge node execute", () => {
  it("throws when video is missing", async () => {
    await expect(
      videoAudioMergeNodeSchema.execute!(
        ctx({
          audio: { type: "audio", value: { url: "https://x/song.wav" } },
        }) as Cfg,
      ),
    ).rejects.toThrow(/Wire a video/);
  });

  it("throws when audio is missing", async () => {
    await expect(
      videoAudioMergeNodeSchema.execute!(
        ctx({
          video: { type: "video", value: { url: "https://x/clip.mp4" } },
        }) as Cfg,
      ),
    ).rejects.toThrow(/Wire an audio/);
  });

  it("muxes video and audio then uploads an MP4", async () => {
    const result = await videoAudioMergeNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/clip.mp4" } },
        audio: { type: "audio", value: { url: "https://x/song.wav" } },
      }) as Cfg,
    );
    expect(replaceVideoAudio).toHaveBeenCalledWith(
      "https://x/clip.mp4",
      "https://x/song.wav",
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") expect(out.value.url).toBe("https://cdn/merged.mp4");
  });

  it("is a non-reactive compose node with video output", () => {
    expect(videoAudioMergeNodeSchema.kind).toBe("video-audio-merge");
    expect(videoAudioMergeNodeSchema.category).toBe("compose");
    expect(videoAudioMergeNodeSchema.reactive).toBe(false);
    expect(videoAudioMergeNodeSchema.outputs[0]?.dataType).toBe("video");
  });
});
