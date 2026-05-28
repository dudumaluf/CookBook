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

  it("is a non-reactive ai-image node outputting image[]", () => {
    expect(falImageNodeSchema.kind).toBe("fal-image");
    expect(falImageNodeSchema.category).toBe("ai-image");
    expect(falImageNodeSchema.reactive).toBe(false);
    expect(falImageNodeSchema.outputs[0]?.dataType).toBe("image");
    expect(falImageNodeSchema.outputs[0]?.multiple).toBe(true);
  });
});
