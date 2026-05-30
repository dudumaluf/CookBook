import { beforeEach, describe, expect, it, vi } from "vitest";

const { probeMedia, computeMediaWindows, sliceAudio, uploadMediaAsset } =
  vi.hoisted(() => ({
    probeMedia: vi.fn(),
    computeMediaWindows: vi.fn(),
    sliceAudio: vi.fn(),
    uploadMediaAsset: vi.fn(),
  }));
vi.mock("@/lib/media", () => ({ probeMedia, computeMediaWindows, sliceAudio }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadMediaAsset }));

import { audioSlicerNodeSchema } from "@/components/nodes/node-audio-slicer";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof audioSlicerNodeSchema.execute>>[0];

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
  probeMedia.mockReset();
  computeMediaWindows.mockReset();
  sliceAudio.mockReset();
  uploadMediaAsset.mockReset();
  probeMedia.mockResolvedValue({ durationMs: 30000 });
  computeMediaWindows.mockReturnValue([
    { index: 0, startMs: 0, endMs: 15000, durationMs: 15000 },
    { index: 1, startMs: 15000, endMs: 30000, durationMs: 15000 },
  ]);
  sliceAudio.mockResolvedValue([
    new Blob(["a"], { type: "audio/wav" }),
    new Blob(["b"], { type: "audio/wav" }),
  ]);
  let n = 0;
  uploadMediaAsset.mockImplementation(() =>
    Promise.resolve({ url: `https://cdn/chunk-${++n}.wav` }),
  );
});

describe("audio-slicer node execute", () => {
  it("throws when neither audio nor video is wired", async () => {
    await expect(
      audioSlicerNodeSchema.execute!(ctx({}) as Cfg),
    ).rejects.toThrow(/Wire an audio/);
  });

  it("extracts + slices the audio track from a wired video", async () => {
    const result = await audioSlicerNodeSchema.execute!(
      ctx({ video: { type: "video", value: { url: "https://x/perf.mp4" } } }) as Cfg,
    );
    // sliceAudio is fed the video URL (it discards video, outputs WAV).
    expect(sliceAudio.mock.calls[0]![0]).toBe("https://x/perf.mp4");
    const out = (result as { output: StandardizedOutput[] }).output;
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.type === "audio")).toBe(true);
  });

  it("prefers the audio input when both audio and video are wired", async () => {
    await audioSlicerNodeSchema.execute!(
      ctx({
        audio: { type: "audio", value: { url: "https://x/song.mp3" } },
        video: { type: "video", value: { url: "https://x/perf.mp4" } },
      }) as Cfg,
    );
    expect(sliceAudio.mock.calls[0]![0]).toBe("https://x/song.mp3");
  });

  it("emits one audio output per window", async () => {
    const result = await audioSlicerNodeSchema.execute!(
      ctx({ audio: { type: "audio", value: { url: "https://x/song.mp3" } } }) as Cfg,
    );
    const out = (result as { output: StandardizedOutput[] }).output;
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.type === "audio")).toBe(true);
    expect(uploadMediaAsset).toHaveBeenCalledTimes(2);
    // Uploads land in the audio folder.
    expect(uploadMediaAsset.mock.calls[0]![1]).toBe("audio");
  });

  it("defaults to WAV output", async () => {
    await audioSlicerNodeSchema.execute!(
      ctx({ audio: { type: "audio", value: { url: "https://x/song.mp3" } } }) as Cfg,
    );
    expect(sliceAudio.mock.calls[0]![2]).toEqual({ format: "wav" });
    // Uploaded slices keep the .wav extension.
    expect((uploadMediaAsset.mock.calls[0]![0] as File).name).toMatch(/\.wav$/);
  });

  it("emits MP3 when outputFormat is mp3", async () => {
    await audioSlicerNodeSchema.execute!(
      ctx(
        { audio: { type: "audio", value: { url: "https://x/song.mp3" } } },
        { outputFormat: "mp3" },
      ) as Cfg,
    );
    expect(sliceAudio.mock.calls[0]![2]).toEqual({ format: "mp3" });
    expect((uploadMediaAsset.mock.calls[0]![0] as File).name).toMatch(/\.mp3$/);
  });

  it("passes the configured window length to the windowing math", async () => {
    await audioSlicerNodeSchema.execute!(
      ctx(
        { audio: { type: "audio", value: { url: "https://x/song.mp3" } } },
        { windowSec: 10, minTailSec: 3 },
      ) as Cfg,
    );
    expect(computeMediaWindows).toHaveBeenCalledWith({
      totalMs: 30000,
      windowMs: 10000,
      minTailMs: 3000,
    });
  });
});
