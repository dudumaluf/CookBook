import { beforeEach, describe, expect, it, vi } from "vitest";

const { callDwpose } = vi.hoisted(() => ({
  callDwpose: vi.fn(),
}));
vi.mock("@/lib/fal/call-dwpose", () => ({ callDwpose }));

import { dwposeNodeSchema } from "@/components/nodes/node-fal-dwpose";
import { DWPOSE_DEFAULT_DRAW_MODE } from "@/lib/fal/types";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type CtxArgs = Parameters<NonNullable<typeof dwposeNodeSchema.execute>>[0];

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
  callDwpose.mockReset();
  callDwpose.mockResolvedValue({
    videoUrl: "https://fal/pose.mp4",
    mime: "video/mp4",
    model: "fal-ai/dwpose/video",
  });
});

describe("dwpose node execute", () => {
  it("throws when no video is wired", async () => {
    await expect(
      dwposeNodeSchema.execute!(ctx({}) as CtxArgs),
    ).rejects.toThrow(/source video/);
  });

  it("calls Fal with the video URL and emits a video", async () => {
    const result = await dwposeNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/v.mp4" } },
      }) as CtxArgs,
    );
    expect(callDwpose).toHaveBeenCalledWith(
      expect.objectContaining({ videoUrl: "https://x/v.mp4" }),
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://fal/pose.mp4");
      expect(out.value.mime).toBe("video/mp4");
    }
  });

  it("defaults to the body-pose draw mode when none is configured", async () => {
    await dwposeNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/v.mp4" } },
      }) as CtxArgs,
    );
    const arg = callDwpose.mock.calls[0]![0] as { drawMode: string };
    expect(arg.drawMode).toBe(DWPOSE_DEFAULT_DRAW_MODE);
    expect(DWPOSE_DEFAULT_DRAW_MODE).toBe("body-pose");
    expect(dwposeNodeSchema.defaultConfig.drawMode).toBe(DWPOSE_DEFAULT_DRAW_MODE);
  });

  it("passes a configured draw mode through to the wrapper", async () => {
    await dwposeNodeSchema.execute!(
      ctx(
        {
          video: { type: "video", value: { url: "https://x/v.mp4" } },
        },
        { drawMode: "face-hand-mask" },
      ) as CtxArgs,
    );
    expect(callDwpose).toHaveBeenCalledWith(
      expect.objectContaining({
        videoUrl: "https://x/v.mp4",
        drawMode: "face-hand-mask",
      }),
    );
  });

  it("is a non-reactive ai-video node with a single video in and video out", () => {
    expect(dwposeNodeSchema.kind).toBe("fal-dwpose");
    expect(dwposeNodeSchema.category).toBe("ai-video");
    expect(dwposeNodeSchema.reactive).toBe(false);
    expect(dwposeNodeSchema.outputs[0]?.dataType).toBe("video");
    expect(dwposeNodeSchema.inputs.map((i) => i.id)).toEqual(["video"]);
    expect(dwposeNodeSchema.inputs[0]?.dataType).toBe("video");
  });
});
