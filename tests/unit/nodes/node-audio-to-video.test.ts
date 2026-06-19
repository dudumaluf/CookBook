import { beforeEach, describe, expect, it, vi } from "vitest";

const { audioToSilentVideo, uploadMediaAsset } = vi.hoisted(() => ({
  audioToSilentVideo: vi.fn(),
  uploadMediaAsset: vi.fn(),
}));
// Keep the real barrel (so the pure `silentVideoDimensions` helper resolves)
// and override only the WebCodecs-backed encode, mirroring node-video-pad.
vi.mock("@/lib/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media")>();
  return { ...actual, audioToSilentVideo };
});
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { audioToVideoNodeSchema } from "@/components/nodes/node-audio-to-video";
import { silentVideoDimensions } from "@/lib/media";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof audioToVideoNodeSchema.execute>>[0];

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
  audioToSilentVideo.mockReset();
  uploadMediaAsset.mockReset();
  audioToSilentVideo.mockResolvedValue(new Blob(["mp4"], { type: "video/mp4" }));
  uploadMediaAsset.mockResolvedValue({ url: "https://cdn/silent-audio.mp4" });
});

describe("audio-to-video node execute", () => {
  it("throws when no audio is wired", async () => {
    await expect(
      audioToVideoNodeSchema.execute!(ctx({}) as Cfg),
    ).rejects.toThrow(/Wire an audio/);
  });

  it("renders the audio as a black-screen MP4 then uploads it as a video", async () => {
    const result = await audioToVideoNodeSchema.execute!(
      ctx({
        audio: { type: "audio", value: { url: "https://x/song.mp3" } },
      }) as Cfg,
    );
    expect(audioToSilentVideo).toHaveBeenCalledWith("https://x/song.mp3", {
      aspectRatio: "16:9",
    });
    // Uploads land in the videos folder (the output is a video).
    expect(uploadMediaAsset).toHaveBeenCalledTimes(1);
    expect(uploadMediaAsset.mock.calls[0]![1]).toBe("videos");
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://cdn/silent-audio.mp4");
      expect(out.value.mime).toBe("video/mp4");
    }
  });

  it("passes the configured aspect ratio through to the media op", async () => {
    await audioToVideoNodeSchema.execute!(
      ctx(
        { audio: { type: "audio", value: { url: "https://x/song.mp3" } } },
        { aspectRatio: "9:16" },
      ) as Cfg,
    );
    expect(audioToSilentVideo).toHaveBeenCalledWith("https://x/song.mp3", {
      aspectRatio: "9:16",
    });
  });

  it("is a non-reactive transform node with a single video output", () => {
    expect(audioToVideoNodeSchema.kind).toBe("audio-to-video");
    expect(audioToVideoNodeSchema.category).toBe("transform");
    expect(audioToVideoNodeSchema.reactive).toBe(false);
    expect(audioToVideoNodeSchema.inputs).toHaveLength(1);
    expect(audioToVideoNodeSchema.inputs[0]?.dataType).toBe("audio");
    expect(audioToVideoNodeSchema.outputs[0]?.dataType).toBe("video");
  });
});

describe("silentVideoDimensions", () => {
  it("maps 16:9 at 720p to 1280×720", () => {
    expect(silentVideoDimensions("16:9", 720)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("maps 1:1 to a square", () => {
    expect(silentVideoDimensions("1:1", 720)).toEqual({
      width: 720,
      height: 720,
    });
  });

  it("defaults to 16:9 at 720p", () => {
    expect(silentVideoDimensions()).toEqual({ width: 1280, height: 720 });
  });

  it("always returns EVEN dimensions (h264 requirement)", () => {
    // 9:16 at 720 → 405 wide, which must round UP to an even 406.
    const portrait = silentVideoDimensions("9:16", 720);
    expect(portrait.height).toBe(720);
    expect(portrait.width % 2).toBe(0);
    expect(portrait.width).toBe(406);
    // An odd target height rounds both axes to even too.
    const odd = silentVideoDimensions("1:1", 101);
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
    expect(odd).toEqual({ width: 102, height: 102 });
  });
});
