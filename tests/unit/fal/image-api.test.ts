import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the input handed to Fal's `subscribe` so we can assert the
// per-model field mapping (the part that lives server-side in image-api).
const { subscribe } = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock("@/lib/fal/client-factory", () => ({
  buildFalClient: vi.fn(async () => ({ client: { subscribe } })),
}));
// Stub the resolver so the module loads without pulling Supabase into the
// test — image-api only references `MissingCredentialsError` for an
// instanceof guard that this happy-path test never trips.
vi.mock("@/lib/byok/resolver", () => ({
  MissingCredentialsError: class MissingCredentialsError extends Error {},
}));

import { generateFalImage } from "@/lib/fal/image-api";
import type { FalImageRequest } from "@/lib/fal/types";

const signal = new AbortController().signal;

beforeEach(() => {
  subscribe.mockReset();
  subscribe.mockResolvedValue({
    data: { images: [{ url: "https://fal/out.png" }], seed: 7 },
  });
});

async function capture(
  req: Omit<FalImageRequest, "prompt"> & { prompt?: string },
): Promise<{ endpoint: string; input: Record<string, unknown> }> {
  await generateFalImage({ prompt: "p", ...req } as FalImageRequest, signal);
  const call = subscribe.mock.calls[0]!;
  return {
    endpoint: call[0] as string,
    input: (call[1] as { input: Record<string, unknown> }).input,
  };
}

describe("generateFalImage — GPT Image 2 input mapping", () => {
  it("hits the edit endpoint and maps quality / output_format / mask_url", async () => {
    const { endpoint, input } = await capture({
      model: "gpt-image-2",
      imageUrls: ["https://x/a.png"],
      quality: "medium",
      outputFormat: "webp",
      maskUrl: "https://x/mask.png",
      imageSize: "landscape_16_9",
      numImages: 2,
    });
    expect(endpoint).toBe("openai/gpt-image-2/edit");
    expect(input.image_urls).toEqual(["https://x/a.png"]);
    expect(input.quality).toBe("medium");
    expect(input.output_format).toBe("webp");
    expect(input.mask_url).toBe("https://x/mask.png");
    expect(input.image_size).toBe("landscape_16_9");
    expect(input.num_images).toBe(2);
  });

  it("forwards a custom { width, height } image_size", async () => {
    const { input } = await capture({
      model: "gpt-image-2",
      imageUrls: ["https://x/a.png"],
      imageSize: { width: 1536, height: 1024 },
    });
    expect(input.image_size).toEqual({ width: 1536, height: 1024 });
  });

  it("drops `seed` for GPT Image 2 (the model has no seed)", async () => {
    const { input } = await capture({
      model: "gpt-image-2",
      imageUrls: ["https://x/a.png"],
      seed: 123,
    });
    expect("seed" in input).toBe(false);
  });

  it("drops an out-of-enum quality value", async () => {
    const { input } = await capture({
      model: "gpt-image-2",
      imageUrls: ["https://x/a.png"],
      quality: "ultra",
    });
    expect("quality" in input).toBe(false);
  });
});

describe("generateFalImage — other models are unaffected", () => {
  it("still sends `seed` and ignores GPT-only fields for Nano Banana 2", async () => {
    const { endpoint, input } = await capture({
      model: "nano-banana-2",
      imageUrls: ["https://x/a.png"],
      seed: 123,
      quality: "high",
      outputFormat: "webp",
      maskUrl: "https://x/mask.png",
    });
    expect(endpoint).toBe("fal-ai/nano-banana-2/edit");
    expect(input.seed).toBe(123);
    expect("quality" in input).toBe(false);
    expect("output_format" in input).toBe(false);
    expect("mask_url" in input).toBe(false);
  });
});
