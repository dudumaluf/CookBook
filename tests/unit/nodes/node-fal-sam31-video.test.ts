import { beforeEach, describe, expect, it, vi } from "vitest";

const { callSam31Video, uploadVideoFromUrl, probeMedia, extractFrame } =
  vi.hoisted(() => ({
    callSam31Video: vi.fn(),
    uploadVideoFromUrl: vi.fn(),
    probeMedia: vi.fn(),
    extractFrame: vi.fn(),
  }));
vi.mock("@/lib/fal/call-sam31-video", () => ({ callSam31Video }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadVideoFromUrl }));
vi.mock("@/lib/media", () => ({ probeMedia, extractFrame }));

import {
  sam31VideoNodeSchema,
  sam31VisualPromptsToPixels,
} from "@/components/nodes/node-fal-sam31-video";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type CtxArgs = Parameters<NonNullable<typeof sam31VideoNodeSchema.execute>>[0];

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
  callSam31Video.mockReset();
  uploadVideoFromUrl.mockReset();
  probeMedia.mockReset();
  callSam31Video.mockResolvedValue({
    videoUrl: "https://fal/mask.mp4",
    mime: "video/mp4",
    model: "fal-ai/sam-3-1/video-rle",
  });
  uploadVideoFromUrl.mockResolvedValue({ url: "https://cdn/mask.mp4" });
  probeMedia.mockResolvedValue({
    width: 1920,
    height: 1080,
    durationMs: 4000,
    hasVideo: true,
    hasAudio: false,
  });
});

describe("sam31VisualPromptsToPixels", () => {
  it("scales normalised points to pixels with fg/bg labels", () => {
    const { pointPrompts, boxPrompts } = sam31VisualPromptsToPixels(
      [
        { x: 0.5, y: 0.5, fg: true },
        { x: 0, y: 0, fg: false },
      ],
      null,
      200,
      100,
    );
    expect(boxPrompts).toBeUndefined();
    expect(pointPrompts).toEqual([
      { x: 100, y: 50, label: 1, frameIndex: 0 },
      { x: 0, y: 0, label: 0, frameIndex: 0 },
    ]);
  });

  it("normalises box corners to a pixel min/max box", () => {
    const { boxPrompts } = sam31VisualPromptsToPixels(
      undefined,
      { x0: 0.6, y0: 0.8, x1: 0.1, y1: 0.2 },
      200,
      100,
    );
    expect(boxPrompts).toEqual([
      { xMin: 20, yMin: 20, xMax: 120, yMax: 80, frameIndex: 0 },
    ]);
  });

  it("drops a degenerate (sub-2px) box", () => {
    const { boxPrompts } = sam31VisualPromptsToPixels(
      undefined,
      { x0: 0.5, y0: 0.5, x1: 0.503, y1: 0.5 },
      200,
      100,
    );
    expect(boxPrompts).toBeUndefined();
  });

  it("returns nothing when there are no marks", () => {
    expect(sam31VisualPromptsToPixels([], null, 200, 100)).toEqual({
      pointPrompts: undefined,
      boxPrompts: undefined,
    });
  });
});

describe("sam31-video node execute", () => {
  it("throws when no video is wired", async () => {
    await expect(
      sam31VideoNodeSchema.execute!(ctx({}) as CtxArgs),
    ).rejects.toThrow(/source video/);
  });

  it("calls Fal, re-hosts the mask, and emits a video", async () => {
    const result = await sam31VideoNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/v.mp4" } },
      }) as CtxArgs,
    );
    expect(callSam31Video).toHaveBeenCalledWith(
      expect.objectContaining({ videoUrl: "https://x/v.mp4", applyMask: true }),
    );
    expect(uploadVideoFromUrl).toHaveBeenCalledWith(
      "https://fal/mask.mp4",
      expect.any(String),
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://cdn/mask.mp4");
      expect(out.value.mime).toBe("video/mp4");
    }
  });

  it("defaults the prompt to 'person' in text mode when nothing is set", async () => {
    await sam31VideoNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/v.mp4" } },
      }) as CtxArgs,
    );
    expect(callSam31Video.mock.calls[0]![0].prompt).toBe("person");
    expect(probeMedia).not.toHaveBeenCalled();
  });

  it("lets a wired prompt input win over the config prompt", async () => {
    await sam31VideoNodeSchema.execute!(
      ctx(
        {
          video: { type: "video", value: { url: "https://x/v.mp4" } },
          prompt: { type: "text", value: "red car" },
        },
        { prompt: "person" },
      ) as CtxArgs,
    );
    expect(callSam31Video.mock.calls[0]![0].prompt).toBe("red car");
  });

  it("forwards applyMask + detectionThreshold from config", async () => {
    await sam31VideoNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/v.mp4" } } },
        { applyMask: false, detectionThreshold: 0.25 },
      ) as CtxArgs,
    );
    expect(callSam31Video).toHaveBeenCalledWith(
      expect.objectContaining({ applyMask: false, detectionThreshold: 0.25 }),
    );
  });

  it("visual mode probes the video and forwards pixel box prompts (no text default)", async () => {
    await sam31VideoNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/v.mp4" } } },
        {
          promptMode: "visual",
          box: { x0: 0.25, y0: 0.5, x1: 0.75, y1: 1 },
        },
      ) as CtxArgs,
    );
    expect(probeMedia).toHaveBeenCalledWith("https://x/v.mp4");
    const arg = callSam31Video.mock.calls[0]![0];
    expect(arg.prompt).toBeUndefined();
    expect(arg.boxPrompts).toEqual([
      { xMin: 480, yMin: 540, xMax: 1440, yMax: 1079, frameIndex: 0 },
    ]);
  });

  it("visual mode forwards foreground/background point prompts", async () => {
    await sam31VideoNodeSchema.execute!(
      ctx(
        { video: { type: "video", value: { url: "https://x/v.mp4" } } },
        {
          promptMode: "visual",
          points: [
            { x: 0.5, y: 0.5, fg: true },
            { x: 0.1, y: 0.1, fg: false },
          ],
        },
      ) as CtxArgs,
    );
    const arg = callSam31Video.mock.calls[0]![0];
    expect(arg.pointPrompts).toEqual([
      { x: 960, y: 540, label: 1, frameIndex: 0 },
      { x: 192, y: 108, label: 0, frameIndex: 0 },
    ]);
  });

  it("visual mode throws when there are no marks and no prompt", async () => {
    await expect(
      sam31VideoNodeSchema.execute!(
        ctx(
          { video: { type: "video", value: { url: "https://x/v.mp4" } } },
          { promptMode: "visual" },
        ) as CtxArgs,
      ),
    ).rejects.toThrow(/Mark the object/);
  });

  it("is a non-reactive ai-video node: video+prompt in, video out", () => {
    expect(sam31VideoNodeSchema.kind).toBe("fal-sam31-video");
    expect(sam31VideoNodeSchema.category).toBe("ai-video");
    expect(sam31VideoNodeSchema.reactive).toBe(false);
    expect(sam31VideoNodeSchema.inputs.map((i) => i.id)).toEqual([
      "video",
      "prompt",
    ]);
    expect(sam31VideoNodeSchema.outputs[0]?.dataType).toBe("video");
    expect(sam31VideoNodeSchema.defaultConfig.applyMask).toBe(true);
  });
});
