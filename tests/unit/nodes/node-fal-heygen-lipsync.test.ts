import { beforeEach, describe, expect, it, vi } from "vitest";

const { callHeygenLipsync } = vi.hoisted(() => ({
  callHeygenLipsync: vi.fn(),
}));
vi.mock("@/lib/fal/call-heygen-lipsync", () => ({ callHeygenLipsync }));

import { heygenLipsyncNodeSchema } from "@/components/nodes/node-fal-heygen-lipsync";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type CtxArgs = Parameters<NonNullable<typeof heygenLipsyncNodeSchema.execute>>[0];

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
  callHeygenLipsync.mockReset();
  callHeygenLipsync.mockResolvedValue({
    videoUrl: "https://fal/dubbed.mp4",
    captionUrl: "https://fal/captions.vtt",
    mime: "video/mp4",
    model: "fal-ai/heygen/v3/lipsync/precision",
  });
});

describe("heygen-lipsync node execute", () => {
  it("throws when no video is wired", async () => {
    await expect(
      heygenLipsyncNodeSchema.execute!(
        ctx({
          audio: { type: "audio", value: { url: "https://x/a.mp3" } },
        }) as CtxArgs,
      ),
    ).rejects.toThrow(/source video/);
  });

  it("throws when no audio is wired", async () => {
    await expect(
      heygenLipsyncNodeSchema.execute!(
        ctx({
          video: { type: "video", value: { url: "https://x/v.mp4" } },
        }) as CtxArgs,
      ),
    ).rejects.toThrow(/replacement audio/);
  });

  it("calls Fal with both URLs and emits a video", async () => {
    const result = await heygenLipsyncNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/v.mp4" } },
        audio: { type: "audio", value: { url: "https://x/a.mp3" } },
      }) as CtxArgs,
    );
    expect(callHeygenLipsync).toHaveBeenCalledWith(
      expect.objectContaining({
        videoUrl: "https://x/v.mp4",
        audioUrl: "https://x/a.mp3",
      }),
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://fal/dubbed.mp4");
      expect(out.value.mime).toBe("video/mp4");
    }
  });

  it("forwards optional knobs only when set", async () => {
    await heygenLipsyncNodeSchema.execute!(
      ctx(
        {
          video: { type: "video", value: { url: "https://x/v.mp4" } },
          audio: { type: "audio", value: { url: "https://x/a.mp3" } },
        },
        {
          title: "dub-take2",
          enableCaption: true,
          enableDynamicDuration: false,
          disableMusicTrack: true,
          enableSpeechEnhancement: true,
          startTime: 0.5,
          endTime: 4,
        },
      ) as CtxArgs,
    );
    expect(callHeygenLipsync).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "dub-take2",
        enableCaption: true,
        enableDynamicDuration: false,
        disableMusicTrack: true,
        enableSpeechEnhancement: true,
        startTime: 0.5,
        endTime: 4,
      }),
    );
  });

  it("rejects a half-set partial-lipsync window", async () => {
    await expect(
      heygenLipsyncNodeSchema.execute!(
        ctx(
          {
            video: { type: "video", value: { url: "https://x/v.mp4" } },
            audio: { type: "audio", value: { url: "https://x/a.mp3" } },
          },
          { startTime: 1 },
        ) as CtxArgs,
      ),
    ).rejects.toThrow(/start and end/);
  });

  it("rejects a window where end is not greater than start", async () => {
    await expect(
      heygenLipsyncNodeSchema.execute!(
        ctx(
          {
            video: { type: "video", value: { url: "https://x/v.mp4" } },
            audio: { type: "audio", value: { url: "https://x/a.mp3" } },
          },
          { startTime: 5, endTime: 5 },
        ) as CtxArgs,
      ),
    ).rejects.toThrow(/greater than start/);
  });

  it("is a non-reactive ai-video node with video output", () => {
    expect(heygenLipsyncNodeSchema.kind).toBe("fal-heygen-lipsync");
    expect(heygenLipsyncNodeSchema.category).toBe("ai-video");
    expect(heygenLipsyncNodeSchema.reactive).toBe(false);
    expect(heygenLipsyncNodeSchema.outputs[0]?.dataType).toBe("video");
    expect(heygenLipsyncNodeSchema.inputs.map((i) => i.id)).toEqual([
      "video",
      "audio",
    ]);
  });
});
