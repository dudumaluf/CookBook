import { beforeEach, describe, expect, it, vi } from "vitest";

const { callSam31Video, uploadVideoFromUrl } = vi.hoisted(() => ({
  callSam31Video: vi.fn(),
  uploadVideoFromUrl: vi.fn(),
}));
vi.mock("@/lib/fal/call-sam31-video", () => ({ callSam31Video }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadVideoFromUrl }));

import { sam31VideoNodeSchema } from "@/components/nodes/node-fal-sam31-video";
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
  callSam31Video.mockResolvedValue({
    videoUrl: "https://fal/mask.mp4",
    mime: "video/mp4",
    model: "fal-ai/sam-3-1/video-rle",
  });
  uploadVideoFromUrl.mockResolvedValue({ url: "https://cdn/mask.mp4" });
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

  it("defaults the prompt to 'person' when neither input nor config is set", async () => {
    await sam31VideoNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/v.mp4" } },
      }) as CtxArgs,
    );
    expect(callSam31Video.mock.calls[0]![0].prompt).toBe("person");
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
