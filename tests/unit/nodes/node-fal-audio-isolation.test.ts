import { beforeEach, describe, expect, it, vi } from "vitest";

const { callAudioIsolation } = vi.hoisted(() => ({
  callAudioIsolation: vi.fn(),
}));
vi.mock("@/lib/fal/call-audio-isolation", () => ({ callAudioIsolation }));

import { falAudioIsolationNodeSchema } from "@/components/nodes/node-fal-audio-isolation";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof falAudioIsolationNodeSchema.execute>>[0];

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
  callAudioIsolation.mockReset();
  callAudioIsolation.mockResolvedValue({
    audioUrl: "https://fal/isolated.mp3",
    mime: "audio/mpeg",
    model: "fal-ai/elevenlabs/audio-isolation",
  });
});

describe("fal-audio-isolation node execute", () => {
  it("throws when neither audio nor video is wired", async () => {
    await expect(
      falAudioIsolationNodeSchema.execute!(ctx({}) as Cfg),
    ).rejects.toThrow(/Wire an audio/);
  });

  it("calls Fal with audioUrl when audio is wired", async () => {
    const result = await falAudioIsolationNodeSchema.execute!(
      ctx({
        audio: { type: "audio", value: { url: "https://x/song.wav" } },
      }) as Cfg,
    );
    expect(callAudioIsolation).toHaveBeenCalledWith(
      expect.objectContaining({ audioUrl: "https://x/song.wav" }),
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("audio");
    if (out.type === "audio") {
      expect(out.value.url).toBe("https://fal/isolated.mp3");
    }
  });

  it("prefers audio over video when both are wired", async () => {
    await falAudioIsolationNodeSchema.execute!(
      ctx({
        audio: { type: "audio", value: { url: "https://x/song.wav" } },
        video: { type: "video", value: { url: "https://x/clip.mp4" } },
      }) as Cfg,
    );
    expect(callAudioIsolation).toHaveBeenCalledWith(
      expect.objectContaining({ audioUrl: "https://x/song.wav" }),
    );
    expect(callAudioIsolation).not.toHaveBeenCalledWith(
      expect.objectContaining({ videoUrl: expect.anything() }),
    );
  });

  it("uses videoUrl when only video is wired", async () => {
    await falAudioIsolationNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/clip.mp4" } },
      }) as Cfg,
    );
    expect(callAudioIsolation).toHaveBeenCalledWith(
      expect.objectContaining({ videoUrl: "https://x/clip.mp4" }),
    );
  });

  it("isolates each audio in a wired array and emits audio[]", async () => {
    callAudioIsolation
      .mockResolvedValueOnce({
        audioUrl: "https://fal/iso-1.mp3",
        mime: "audio/mpeg",
        model: "fal-ai/elevenlabs/audio-isolation",
      })
      .mockResolvedValueOnce({
        audioUrl: "https://fal/iso-2.mp3",
        mime: "audio/mpeg",
        model: "fal-ai/elevenlabs/audio-isolation",
      })
      .mockResolvedValueOnce({
        audioUrl: "https://fal/iso-3.mp3",
        mime: "audio/mpeg",
        model: "fal-ai/elevenlabs/audio-isolation",
      });

    const result = await falAudioIsolationNodeSchema.execute!(
      ctx({
        audio: [
          { type: "audio", value: { url: "https://x/s1.wav" } },
          { type: "audio", value: { url: "https://x/s2.wav" } },
          { type: "audio", value: { url: "https://x/s3.wav" } },
        ],
      }) as Cfg,
    );

    expect(callAudioIsolation).toHaveBeenCalledTimes(3);
    expect(callAudioIsolation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ audioUrl: "https://x/s1.wav" }),
    );
    expect(callAudioIsolation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ audioUrl: "https://x/s2.wav" }),
    );
    const out = (result as { output: StandardizedOutput[] }).output;
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(3);
    expect(out.map((o) => (o.type === "audio" ? o.value.url : null))).toEqual([
      "https://fal/iso-1.mp3",
      "https://fal/iso-2.mp3",
      "https://fal/iso-3.mp3",
    ]);
  });

  it("accepts a multiple audio input and emits a multiple audio output", () => {
    const audioIn = falAudioIsolationNodeSchema.inputs.find((i) => i.id === "audio");
    expect(audioIn?.multiple).toBe(true);
    expect(falAudioIsolationNodeSchema.outputs[0]?.multiple).toBe(true);
    expect(falAudioIsolationNodeSchema.cacheVersion).toBe(3);
  });

  it("keeps successful clips when a later chunk is too short", async () => {
    callAudioIsolation
      .mockResolvedValueOnce({
        audioUrl: "https://fal/iso-1.mp3",
        mime: "audio/mpeg",
        model: "fal-ai/elevenlabs/audio-isolation",
      })
      .mockRejectedValueOnce(
        new Error(
          "Fail: audio_url: Media duration is too short: 3.29 seconds. This endpoint requires a media duration of at least 4.6 seconds.",
        ),
      );

    const result = await falAudioIsolationNodeSchema.execute!(
      ctx({
        audio: [
          { type: "audio", value: { url: "https://x/s1.wav" } },
          { type: "audio", value: { url: "https://x/s2.wav" } },
        ],
      }) as Cfg,
    );

    const out = (result as { output: StandardizedOutput[] }).output;
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "audio",
      value: { url: "https://fal/iso-1.mp3" },
    });
  });

  it("skips a chunk with known duration under 4.6s without calling Fal", async () => {
    const result = await falAudioIsolationNodeSchema.execute!(
      ctx({
        audio: [
          { type: "audio", value: { url: "https://x/s1.wav", durationMs: 15_000 } },
          { type: "audio", value: { url: "https://x/tail.wav", durationMs: 3_291 } },
        ],
      }) as Cfg,
    );

    expect(callAudioIsolation).toHaveBeenCalledTimes(1);
    expect(callAudioIsolation).toHaveBeenCalledWith(
      expect.objectContaining({ audioUrl: "https://x/s1.wav" }),
    );
    const out = (result as { output: StandardizedOutput[] }).output;
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "audio",
      value: { url: "https://fal/isolated.mp3" },
    });
  });

  it("throws when every wired chunk is too short", async () => {
    await expect(
      falAudioIsolationNodeSchema.execute!(
        ctx({
          audio: [
            { type: "audio", value: { url: "https://x/a.wav", durationMs: 2_000 } },
            { type: "audio", value: { url: "https://x/b.wav", durationMs: 3_000 } },
          ],
        }) as Cfg,
      ),
    ).rejects.toThrow(/too short/);
    expect(callAudioIsolation).not.toHaveBeenCalled();
  });
});
