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
  it("throws when no source is wired", async () => {
    await expect(
      audioToVideoNodeSchema.execute!(ctx({}) as Cfg),
    ).rejects.toThrow(/Wire an audio/);
  });

  it("renders a single audio as a black-screen MP4 then uploads it as a video[1]", async () => {
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
    // A single wired track still yields a one-element video array (the
    // `out` socket is `multiple`), so downstream sees a uniform shape.
    const out = (result as { output: StandardizedOutput[] }).output;
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    const first = out[0]!;
    expect(first.type).toBe("video");
    if (first.type === "video") {
      expect(first.value.url).toBe("https://cdn/silent-audio.mp4");
      expect(first.value.mime).toBe("video/mp4");
    }
  });

  it("maps an array of audio chunks → one silent video per chunk", async () => {
    const result = await audioToVideoNodeSchema.execute!(
      ctx({
        audio: [
          { type: "audio", value: { url: "https://x/a1.wav" } },
          { type: "audio", value: { url: "https://x/a2.wav" } },
          { type: "audio", value: { url: "https://x/a3.wav" } },
        ],
      }) as Cfg,
    );
    expect(audioToSilentVideo).toHaveBeenCalledTimes(3);
    expect(audioToSilentVideo).toHaveBeenNthCalledWith(1, "https://x/a1.wav", {
      aspectRatio: "16:9",
    });
    expect(audioToSilentVideo).toHaveBeenNthCalledWith(3, "https://x/a3.wav", {
      aspectRatio: "16:9",
    });
    expect(uploadMediaAsset).toHaveBeenCalledTimes(3);
    const out = (result as { output: StandardizedOutput[] }).output;
    expect(out).toHaveLength(3);
    expect(out.every((o) => o.type === "video")).toBe(true);
  });

  it("accepts a video source — keeps its soundtrack, blanks the picture", async () => {
    const result = await audioToVideoNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/perf.mp4" } },
      }) as Cfg,
    );
    // The same op handles a video URL (it reads the soundtrack via
    // replaceVideoAudio's getPrimaryAudioTrack).
    expect(audioToSilentVideo).toHaveBeenCalledWith("https://x/perf.mp4", {
      aspectRatio: "16:9",
    });
    const out = (result as { output: StandardizedOutput[] }).output;
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("video");
  });

  it("audio wins when both an audio and a video are wired", async () => {
    await audioToVideoNodeSchema.execute!(
      ctx({
        audio: { type: "audio", value: { url: "https://x/song.mp3" } },
        video: { type: "video", value: { url: "https://x/perf.mp4" } },
      }) as Cfg,
    );
    expect(audioToSilentVideo).toHaveBeenCalledTimes(1);
    expect(audioToSilentVideo).toHaveBeenCalledWith("https://x/song.mp3", {
      aspectRatio: "16:9",
    });
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

  it("is a non-reactive transform node that batches audio|video → video[]", () => {
    expect(audioToVideoNodeSchema.kind).toBe("audio-to-video");
    expect(audioToVideoNodeSchema.title).toBe("Silent Video");
    expect(audioToVideoNodeSchema.category).toBe("transform");
    expect(audioToVideoNodeSchema.reactive).toBe(false);
    // Two sources: an audio track OR a video (whose soundtrack we keep).
    expect(audioToVideoNodeSchema.inputs).toHaveLength(2);
    const byId = Object.fromEntries(
      audioToVideoNodeSchema.inputs.map((i) => [i.id, i]),
    );
    expect(byId.audio?.dataType).toBe("audio");
    expect(byId.video?.dataType).toBe("video");
    // `multiple` is what lets a sliced array land whole (one clip per chunk)
    // instead of just the previewed item.
    expect(byId.audio?.multiple).toBe(true);
    expect(byId.video?.multiple).toBe(true);
    expect(audioToVideoNodeSchema.outputs[0]?.dataType).toBe("video");
    expect(audioToVideoNodeSchema.outputs[0]?.multiple).toBe(true);
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
