import { beforeEach, describe, expect, it, vi } from "vitest";

const { callVeedSubtitles } = vi.hoisted(() => ({
  callVeedSubtitles: vi.fn(),
}));
vi.mock("@/lib/fal/call-veed-subtitles", () => ({ callVeedSubtitles }));

import { veedSubtitlesNodeSchema } from "@/components/nodes/node-fal-veed-subtitles";
import { isVeedDynamicPreset } from "@/lib/fal/types";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type CtxArgs = Parameters<
  NonNullable<typeof veedSubtitlesNodeSchema.execute>
>[0];

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
  callVeedSubtitles.mockReset();
  callVeedSubtitles.mockResolvedValue({
    videoUrl: "https://fal/subbed.mp4",
    mime: "video/mp4",
    model: "veed/subtitles",
  });
});

describe("veed-subtitles node execute", () => {
  it("throws when no video is wired", async () => {
    await expect(
      veedSubtitlesNodeSchema.execute!(ctx({}) as CtxArgs),
    ).rejects.toThrow(/source video/);
  });

  it("calls Fal with the video URL and emits a video", async () => {
    const result = await veedSubtitlesNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/v.mp4" } },
      }) as CtxArgs,
    );
    expect(callVeedSubtitles).toHaveBeenCalledWith(
      expect.objectContaining({ videoUrl: "https://x/v.mp4" }),
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://fal/subbed.mp4");
      expect(out.value.mime).toBe("video/mp4");
    }
  });

  it("defaults to a basic (1x) preset when none is configured", async () => {
    await veedSubtitlesNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/v.mp4" } },
      }) as CtxArgs,
    );
    const arg = callVeedSubtitles.mock.calls[0]![0] as { preset: string };
    expect(isVeedDynamicPreset(arg.preset)).toBe(false);
    // The node's declared default is itself a basic (1x) preset.
    const def = veedSubtitlesNodeSchema.defaultConfig.preset;
    expect(def).toBeDefined();
    expect(isVeedDynamicPreset(def as string)).toBe(false);
  });

  it("passes preset / language / translation through to the wrapper", async () => {
    await veedSubtitlesNodeSchema.execute!(
      ctx(
        {
          video: { type: "video", value: { url: "https://x/v.mp4" } },
        },
        {
          preset: "glass",
          language: "en-US",
          translationLanguage: "es-ES",
        },
      ) as CtxArgs,
    );
    expect(callVeedSubtitles).toHaveBeenCalledWith(
      expect.objectContaining({
        videoUrl: "https://x/v.mp4",
        preset: "glass",
        language: "en-US",
        translationLanguage: "es-ES",
      }),
    );
  });

  it("omits optional language / translation when unset", async () => {
    await veedSubtitlesNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/v.mp4" } },
      }) as CtxArgs,
    );
    const arg = callVeedSubtitles.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("language");
    expect(arg).not.toHaveProperty("translationLanguage");
  });

  it("is a non-reactive ai-video node with a single video in and video out", () => {
    expect(veedSubtitlesNodeSchema.kind).toBe("fal-veed-subtitles");
    expect(veedSubtitlesNodeSchema.category).toBe("ai-video");
    expect(veedSubtitlesNodeSchema.reactive).toBe(false);
    expect(veedSubtitlesNodeSchema.outputs[0]?.dataType).toBe("video");
    expect(veedSubtitlesNodeSchema.inputs.map((i) => i.id)).toEqual(["video"]);
    expect(veedSubtitlesNodeSchema.inputs[0]?.dataType).toBe("video");
  });
});
