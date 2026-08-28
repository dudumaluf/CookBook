import { beforeEach, describe, expect, it, vi } from "vitest";

const { callH3Max } = vi.hoisted(() => ({
  callH3Max: vi.fn(),
}));
vi.mock("@/lib/fal/call-h3-max", () => ({ callH3Max }));

import { h3MaxVideoNodeSchema } from "@/components/nodes/node-fal-h3-max";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof h3MaxVideoNodeSchema.execute>>[0];

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
  callH3Max.mockReset();
  callH3Max.mockResolvedValue({
    videoUrl: "https://cdn.fal.media/h3.mp4",
    mime: "video/mp4",
    model: "minimax/h3-max/image-to-video",
  });
});

describe("h3-max-video node execute", () => {
  it("throws when no prompt is wired", async () => {
    await expect(
      h3MaxVideoNodeSchema.execute!(
        ctx({ image: { type: "image", value: { url: "https://x/a.png" } } }) as Cfg,
      ),
    ).rejects.toThrow(/needs a prompt/i);
    expect(callH3Max).not.toHaveBeenCalled();
  });

  it("throws when a prompt is wired but no start image", async () => {
    await expect(
      h3MaxVideoNodeSchema.execute!(
        ctx({ prompt: { type: "text", value: "pull back" } }) as Cfg,
      ),
    ).rejects.toThrow(/start image/i);
    expect(callH3Max).not.toHaveBeenCalled();
  });

  it("generates from prompt + start image and emits a video", async () => {
    const result = await h3MaxVideoNodeSchema.execute!(
      ctx({
        prompt: { type: "text", value: "camera slowly pulls back" },
        image: { type: "image", value: { url: "https://x/start.png" } },
      }) as Cfg,
    );

    expect(callH3Max).toHaveBeenCalledTimes(1);
    const arg = callH3Max.mock.calls[0]![0];
    expect(arg.prompt).toBe("camera slowly pulls back");
    expect(arg.imageUrl).toBe("https://x/start.png");
    expect(arg.endImageUrl).toBeUndefined();
    expect(arg.duration).toBe(5);
    expect(arg.resolution).toBe("768P");
    expect(arg.promptExpansionMode).toBe("balanced");
    expect(arg.enableSafetyChecker).toBe(true);
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://cdn.fal.media/h3.mp4");
    }
  });

  it("forwards an optional end image", async () => {
    await h3MaxVideoNodeSchema.execute!(
      ctx({
        prompt: { type: "text", value: "morph" },
        image: { type: "image", value: { url: "https://x/start.png" } },
        end: { type: "image", value: { url: "https://x/end.png" } },
      }) as Cfg,
    );
    const arg = callH3Max.mock.calls[0]![0];
    expect(arg.endImageUrl).toBe("https://x/end.png");
  });

  it("sends configured duration, resolution, and expansion", async () => {
    await h3MaxVideoNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "x" },
          image: { type: "image", value: { url: "https://x/a.png" } },
        },
        {
          duration: 12,
          resolution: "480P",
          promptExpansionMode: "quality",
          enableSafetyChecker: false,
        },
      ) as Cfg,
    );
    const arg = callH3Max.mock.calls[0]![0];
    expect(arg.duration).toBe(12);
    expect(arg.resolution).toBe("480P");
    expect(arg.promptExpansionMode).toBe("quality");
    expect(arg.enableSafetyChecker).toBe(false);
  });
});

describe("h3-max-video node schema", () => {
  it("exposes prompt + start + optional end sockets", () => {
    expect(h3MaxVideoNodeSchema.inputs.map((h) => h.id)).toEqual([
      "prompt",
      "image",
      "end",
    ]);
    expect(h3MaxVideoNodeSchema.inputs.find((h) => h.id === "image")?.label).toBe(
      "start",
    );
  });

  it("is a non-reactive ai-video node emitting video", () => {
    expect(h3MaxVideoNodeSchema.kind).toBe("h3-max-video");
    expect(h3MaxVideoNodeSchema.category).toBe("ai-video");
    expect(h3MaxVideoNodeSchema.reactive).toBe(false);
    expect(h3MaxVideoNodeSchema.outputs[0]?.dataType).toBe("video");
  });
});
