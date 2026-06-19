import { beforeEach, describe, expect, it, vi } from "vitest";

const { callSam3, uploadImageFromUrl } = vi.hoisted(() => ({
  callSam3: vi.fn(),
  uploadImageFromUrl: vi.fn(),
}));
vi.mock("@/lib/fal/call-sam3", () => ({ callSam3 }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadImageFromUrl }));

import { hasSam3Overrides, sam3NodeSchema } from "@/components/nodes/node-sam3";
import type { ExecContext, StandardizedOutput } from "@/types/node";

const img = (url: string): StandardizedOutput => ({
  type: "image",
  value: { url },
});
const text = (value: string): StandardizedOutput => ({ type: "text", value });

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
  callSam3.mockReset();
  uploadImageFromUrl.mockReset();
  callSam3.mockResolvedValue({
    primaryUrl: "https://fal/cutout.png",
    maskUrls: ["https://fal/mask-0.png"],
    model: "fal-ai/sam-3/image",
  });
  uploadImageFromUrl.mockResolvedValue({ url: "https://cdn/sam3-cutout.png" });
});

describe("sam-3 node execute", () => {
  it("throws when no image is wired", async () => {
    await expect(sam3NodeSchema.execute!(ctx({}) as never)).rejects.toThrow(
      /Wire an image/,
    );
  });

  it("defaults the prompt to 'person' and forces a transparent PNG cutout", async () => {
    const result = await sam3NodeSchema.execute!(
      ctx({ image: img("https://x/me.jpg") }) as never,
    );
    expect(callSam3).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: "https://x/me.jpg",
        prompt: "person",
        applyMask: true,
        outputFormat: "png",
      }),
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("image");
    if (out.type === "image") {
      expect(out.value.url).toBe("https://cdn/sam3-cutout.png");
      expect(out.value.mime).toBe("image/png");
    }
  });

  it("uses the settings prompt when no prompt input is wired", async () => {
    await sam3NodeSchema.execute!(
      ctx({ image: img("https://x/me.jpg") }, { prompt: "dog" }) as never,
    );
    expect(callSam3).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "dog" }),
    );
  });

  it("lets a wired prompt input override the settings prompt", async () => {
    await sam3NodeSchema.execute!(
      ctx(
        { image: img("https://x/me.jpg"), prompt: text("red car") },
        { prompt: "dog" },
      ) as never,
    );
    expect(callSam3).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "red car" }),
    );
  });

  it("falls back to the first raw mask when no primary cutout is returned", async () => {
    callSam3.mockResolvedValue({
      maskUrls: ["https://fal/mask-only.png"],
      model: "fal-ai/sam-3/image",
    });
    await sam3NodeSchema.execute!(ctx({ image: img("https://x/me.jpg") }) as never);
    expect(uploadImageFromUrl).toHaveBeenCalledWith(
      "https://fal/mask-only.png",
      expect.any(String),
    );
  });

  it("throws when SAM 3 returns nothing usable", async () => {
    callSam3.mockResolvedValue({ maskUrls: [], model: "fal-ai/sam-3/image" });
    await expect(
      sam3NodeSchema.execute!(ctx({ image: img("https://x/me.jpg") }) as never),
    ).rejects.toThrow(/no usable image/);
  });
});

describe("hasSam3Overrides", () => {
  it("is false by default and true once a prompt is set", () => {
    expect(hasSam3Overrides({})).toBe(false);
    expect(hasSam3Overrides({ prompt: "  " })).toBe(false);
    expect(hasSam3Overrides({ prompt: "person" })).toBe(true);
  });
});
