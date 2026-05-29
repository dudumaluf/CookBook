import { beforeEach, describe, expect, it, vi } from "vitest";

const { callFalImage } = vi.hoisted(() => ({ callFalImage: vi.fn() }));
vi.mock("@/lib/fal/call-fal-image", () => ({ callFalImage }));

import { falImageNodeSchema } from "@/components/nodes/node-fal-image";
import type { ExecContext, StandardizedOutput } from "@/types/node";

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
  callFalImage.mockReset();
  callFalImage.mockResolvedValue({
    imageUrls: ["https://cdn.fal.media/img-1.png"],
    model: "fal-ai/nano-banana-2",
  });
});

describe("fal-image node", () => {
  it("throws when no prompt is wired", async () => {
    await expect(
      falImageNodeSchema.execute!(ctx({}) as never),
    ).rejects.toThrow(/Prompt is empty/);
  });

  it("generates from a prompt with the default model", async () => {
    const result = await falImageNodeSchema.execute!(
      ctx({ prompt: { type: "text", value: "a cat" } }) as never,
    );
    expect(callFalImage).toHaveBeenCalledTimes(1);
    expect(callFalImage.mock.calls[0]![0].model).toBe("nano-banana-2");
    expect(callFalImage.mock.calls[0]![0].imageUrls).toBeUndefined();
    const out = (result as { output: StandardizedOutput[] }).output;
    expect(out[0]?.type).toBe("image");
  });

  it("forwards reference images (edit mode) + selected model", async () => {
    await falImageNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "make it noir" },
          image: [{ type: "image", value: { url: "https://x/a.png" } }],
        },
        { model: "flux-2-pro" },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    expect(arg.model).toBe("flux-2-pro");
    expect(arg.imageUrls).toEqual(["https://x/a.png"]);
  });

  it("routes wired images to Krea style references (not edit) with strength", async () => {
    await falImageNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "van gogh vibes" },
          image: [
            { type: "image", value: { url: "https://x/a.png" } },
            { type: "image", value: { url: "https://x/b.png" } },
          ],
        },
        { model: "krea-v2-medium", styleStrength: 0.6, creativity: "high", aspectRatio: "16:9" },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    expect(arg.model).toBe("krea-v2-medium");
    // Krea has no edit endpoint — wired images become style refs.
    expect(arg.imageUrls).toBeUndefined();
    expect(arg.styleReferences).toEqual([
      { imageUrl: "https://x/a.png", strength: 0.6 },
      { imageUrl: "https://x/b.png", strength: 0.6 },
    ]);
    expect(arg.creativity).toBe("high");
    expect(arg.aspectRatio).toBe("16:9");
  });

  it("drops model-incompatible fields (creativity on nano is not sent)", async () => {
    await falImageNodeSchema.execute!(
      ctx(
        { prompt: { type: "text", value: "a cat" } },
        { model: "nano-banana-2", creativity: "high", resolution: "2K", aspectRatio: "9:16" },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    // nano supports aspect ratio + resolution but NOT creativity.
    expect(arg.creativity).toBeUndefined();
    expect(arg.resolution).toBe("2K");
    expect(arg.aspectRatio).toBe("9:16");
  });

  it("is a non-reactive ai-image node outputting image[]", () => {
    expect(falImageNodeSchema.kind).toBe("fal-image");
    expect(falImageNodeSchema.category).toBe("ai-image");
    expect(falImageNodeSchema.reactive).toBe(false);
    expect(falImageNodeSchema.outputs[0]?.dataType).toBe("image");
    expect(falImageNodeSchema.outputs[0]?.multiple).toBe(true);
  });
});
