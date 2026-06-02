import { beforeEach, describe, expect, it, vi } from "vitest";

const { callFalImage } = vi.hoisted(() => ({ callFalImage: vi.fn() }));
vi.mock("@/lib/fal/call-fal-image", () => ({ callFalImage }));

import {
  __falImageTestHooks,
  falImageConfiguredAspect,
  falImageNodeSchema,
} from "@/components/nodes/node-fal-image";
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

  it("forwards a single wired image-0 reference (edit mode)", async () => {
    await falImageNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "make it noir" },
          "image-0": { type: "image", value: { url: "https://x/a.png" } },
        },
        { model: "flux-2-pro" },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    expect(arg.model).toBe("flux-2-pro");
    expect(arg.imageUrls).toEqual(["https://x/a.png"]);
  });

  it("collects multiple wired images in port order (image-0..N)", async () => {
    // Wire 5 images out of order on the inputs map; execute should still
    // collect them by port index 0..4.
    await falImageNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "blend these" },
          "image-2": { type: "image", value: { url: "https://x/c.png" } },
          "image-0": { type: "image", value: { url: "https://x/a.png" } },
          "image-4": { type: "image", value: { url: "https://x/e.png" } },
          "image-1": { type: "image", value: { url: "https://x/b.png" } },
          "image-3": { type: "image", value: { url: "https://x/d.png" } },
        },
        { model: "nano-banana-2" },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    expect(arg.imageUrls).toEqual([
      "https://x/a.png",
      "https://x/b.png",
      "https://x/c.png",
      "https://x/d.png",
      "https://x/e.png",
    ]);
  });

  it("supports up to 14 wired references on Nano Banana 2", async () => {
    const inputs: Record<string, StandardizedOutput> = {
      prompt: { type: "text", value: "compose" },
    };
    for (let i = 0; i < 14; i++) {
      inputs[`image-${i}`] = {
        type: "image",
        value: { url: `https://x/${i}.png` },
      };
    }
    await falImageNodeSchema.execute!(
      ctx(inputs, { model: "nano-banana-2" }) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    expect(arg.imageUrls).toHaveLength(14);
    expect(arg.imageUrls[13]).toBe("https://x/13.png");
  });

  it("caps refs at the model's per-call max (Flux 2 Pro = 8)", async () => {
    const inputs: Record<string, StandardizedOutput> = {
      prompt: { type: "text", value: "compose" },
    };
    // Provide 12 wired entries; Flux only accepts 8.
    for (let i = 0; i < 12; i++) {
      inputs[`image-${i}`] = {
        type: "image",
        value: { url: `https://x/${i}.png` },
      };
    }
    await falImageNodeSchema.execute!(
      ctx(inputs, { model: "flux-2-pro" }) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    // Iteration stops at modelMaxRefs(flux)=8 — anything past that index
    // is never read off the inputs map.
    expect(arg.imageUrls).toHaveLength(8);
  });

  it("routes wired images to Krea style references (not edit) with strength", async () => {
    await falImageNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "van gogh vibes" },
          "image-0": { type: "image", value: { url: "https://x/a.png" } },
          "image-1": { type: "image", value: { url: "https://x/b.png" } },
        },
        {
          model: "krea-v2-medium",
          styleStrength: 0.6,
          creativity: "high",
          aspectRatio: "16:9",
        },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    expect(arg.model).toBe("krea-v2-medium");
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
        {
          model: "nano-banana-2",
          creativity: "high",
          resolution: "2K",
          aspectRatio: "9:16",
        },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    expect(arg.creativity).toBeUndefined();
    expect(arg.resolution).toBe("2K");
    expect(arg.aspectRatio).toBe("9:16");
  });

  it("sends image_size as a preset string for Flux when imageSizeMode='preset'", async () => {
    await falImageNodeSchema.execute!(
      ctx(
        { prompt: { type: "text", value: "a cat" } },
        {
          model: "flux-2-pro",
          imageSize: "landscape_16_9",
          imageSizeMode: "preset",
        },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    expect(arg.imageSize).toBe("landscape_16_9");
  });

  it("sends image_size as { width, height } for Flux when imageSizeMode='custom'", async () => {
    await falImageNodeSchema.execute!(
      ctx(
        { prompt: { type: "text", value: "a cat" } },
        {
          model: "flux-2-pro",
          imageSizeMode: "custom",
          customWidth: 1280,
          customHeight: 720,
        },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    expect(arg.imageSize).toEqual({ width: 1280, height: 720 });
  });

  it("sends image_size as { width, height } for Seedream in custom mode", async () => {
    await falImageNodeSchema.execute!(
      ctx(
        { prompt: { type: "text", value: "a cat" } },
        {
          model: "seedream-v4.5",
          imageSizeMode: "custom",
          customWidth: 2048,
          customHeight: 3072,
        },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    expect(arg.imageSize).toEqual({ width: 2048, height: 3072 });
  });

  it("falls back to the preset when custom width/height are missing", async () => {
    await falImageNodeSchema.execute!(
      ctx(
        { prompt: { type: "text", value: "a cat" } },
        {
          model: "flux-2-pro",
          imageSize: "square_hd",
          imageSizeMode: "custom",
          // no customWidth/customHeight set
        },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    expect(arg.imageSize).toBe("square_hd");
  });

  it("ignores custom mode for Krea (no width/height support)", async () => {
    await falImageNodeSchema.execute!(
      ctx(
        { prompt: { type: "text", value: "a cat" } },
        {
          model: "krea-v2-medium",
          imageSizeMode: "custom",
          customWidth: 1024,
          customHeight: 1024,
        },
      ) as never,
    );
    const arg = callFalImage.mock.calls[0]![0];
    // Krea has no imageSizes cap and no support for image_size at all —
    // the field should be omitted entirely rather than passed as object.
    expect(arg.imageSize).toBeUndefined();
  });

  it("is a non-reactive ai-image node outputting image[]", () => {
    expect(falImageNodeSchema.kind).toBe("fal-image");
    expect(falImageNodeSchema.category).toBe("ai-image");
    expect(falImageNodeSchema.reactive).toBe(false);
    expect(falImageNodeSchema.outputs[0]?.dataType).toBe("image");
    expect(falImageNodeSchema.outputs[0]?.multiple).toBe(true);
  });
});

describe("fal-image smart-input ports", () => {
  const { falImageInputs, modelMaxRefs, clampImagePorts, IMAGE_PORT_PREFIX } =
    __falImageTestHooks;

  it("renders a fresh node with one prompt + two image slots", () => {
    const inputs = falImageInputs({});
    expect(inputs[0]).toMatchObject({ id: "prompt", dataType: "text" });
    expect(inputs.slice(1).map((i) => i.id)).toEqual([
      `${IMAGE_PORT_PREFIX}0`,
      `${IMAGE_PORT_PREFIX}1`,
    ]);
  });

  it("respects imagePorts for an extended slot count", () => {
    const inputs = falImageInputs({ model: "nano-banana-2", imagePorts: 5 });
    const imageSlots = inputs.filter((i) => i.dataType === "image");
    expect(imageSlots.map((i) => i.id)).toEqual([
      "image-0",
      "image-1",
      "image-2",
      "image-3",
      "image-4",
    ]);
  });

  it("caps imagePorts at the active model's max", () => {
    // Flux 2 Pro caps at 8 — even if config asks for 20, only 8 render.
    const inputs = falImageInputs({ model: "flux-2-pro", imagePorts: 20 });
    expect(inputs.filter((i) => i.dataType === "image")).toHaveLength(8);
  });

  it("modelMaxRefs returns the right per-model ceiling", () => {
    expect(modelMaxRefs("nano-banana-2")).toBe(14);
    expect(modelMaxRefs("flux-2-pro")).toBe(8);
    expect(modelMaxRefs("seedream-v4.5")).toBe(10);
    expect(modelMaxRefs("krea-v2-medium")).toBe(10);
    expect(modelMaxRefs("krea-v2-large")).toBe(10);
  });

  it("clampImagePorts floors at MIN_IMAGE_PORTS and caps at the model's max", () => {
    expect(clampImagePorts("flux-2-pro", 1)).toBe(2);
    expect(clampImagePorts("flux-2-pro", 6)).toBe(6);
    expect(clampImagePorts("flux-2-pro", 50)).toBe(8);
    expect(clampImagePorts("nano-banana-2", 50)).toBe(14);
  });

  it("does not crash when config.model is the Fal endpoint id (legacy bug)", () => {
    // 2026-06-02 regression guard: a project written with
    // `config.model = "fal-ai/nano-banana-2"` (the endpoint id —
    // assistant slip) used to throw `Cannot read properties of
    // undefined (reading 'editRefs')` here, which propagated through
    // React Flow's `getInputs(config)` and bricked the canvas. Now
    // `normalizeFalImageModel` falls back to the default model so the
    // legacy value just renders as nano-banana-2.
    //
    // Cast to bypass FalImageNodeConfig's type contract — the whole
    // point is to simulate a hand-edited / DB-deserialized value that
    // doesn't match the runtime registry.
    const badConfig = {
      model: "fal-ai/nano-banana-2",
      imagePorts: 5,
    } as unknown as Parameters<typeof falImageInputs>[0];
    expect(() => falImageInputs(badConfig)).not.toThrow();
    const inputs = falImageInputs(badConfig);
    expect(inputs.filter((i) => i.dataType === "image")).toHaveLength(5);
    // Cast to string-typed arg so we exercise the defensive path in
    // `modelMaxRefs(string | FalImageModel | undefined)`.
    expect(modelMaxRefs("fal-ai/nano-banana-2" as string)).toBe(14);
  });

  it("falls back to the default model on any unknown string", () => {
    const badConfig = {
      model: "totally-fake-model",
    } as unknown as Parameters<typeof falImageInputs>[0];
    expect(() => falImageInputs(badConfig)).not.toThrow();
    expect(modelMaxRefs("totally-fake-model" as string)).toBe(14);
    expect(clampImagePorts("totally-fake-model" as string, 50)).toBe(14);
  });
});

describe("falImageConfiguredAspect — preview aspect resolution", () => {
  it("resolves nano-banana / krea aspectRatio strings (16:9 → '16 / 9')", () => {
    expect(falImageConfiguredAspect({ aspectRatio: "16:9" })).toBe("16 / 9");
    expect(falImageConfiguredAspect({ aspectRatio: "9:16" })).toBe("9 / 16");
    expect(falImageConfiguredAspect({ aspectRatio: "1:1" })).toBe("1 / 1");
    expect(falImageConfiguredAspect({ aspectRatio: "3:4" })).toBe("3 / 4");
  });

  it("resolves flux/seedream image_size presets to canonical aspects", () => {
    expect(falImageConfiguredAspect({ imageSize: "square" })).toBe("1 / 1");
    expect(falImageConfiguredAspect({ imageSize: "square_hd" })).toBe("1 / 1");
    expect(falImageConfiguredAspect({ imageSize: "portrait_4_3" })).toBe(
      "3 / 4",
    );
    expect(falImageConfiguredAspect({ imageSize: "portrait_16_9" })).toBe(
      "9 / 16",
    );
    expect(falImageConfiguredAspect({ imageSize: "landscape_4_3" })).toBe(
      "4 / 3",
    );
    expect(falImageConfiguredAspect({ imageSize: "landscape_16_9" })).toBe(
      "16 / 9",
    );
  });

  it("falls back to '1 / 1' for auto presets and unknown strings", () => {
    expect(falImageConfiguredAspect({ imageSize: "auto_2K" })).toBe("1 / 1");
    expect(falImageConfiguredAspect({ imageSize: "auto_4K" })).toBe("1 / 1");
    expect(falImageConfiguredAspect({ imageSize: "weird_unknown" })).toBe(
      "1 / 1",
    );
  });

  it("uses custom width/height when imageSizeMode is 'custom'", () => {
    expect(
      falImageConfiguredAspect({
        imageSizeMode: "custom",
        customWidth: 1920,
        customHeight: 1080,
      }),
    ).toBe("1920 / 1080");
    expect(
      falImageConfiguredAspect({
        imageSizeMode: "custom",
        customWidth: 1024,
        customHeight: 1024,
      }),
    ).toBe("1024 / 1024");
  });

  it("ignores custom dimensions when imageSizeMode !== 'custom' (preset wins)", () => {
    // The body's preset/custom toggle owns the decision — even if customWidth
    // / customHeight are set, mode === 'preset' should mean the preset wins.
    expect(
      falImageConfiguredAspect({
        imageSizeMode: "preset",
        imageSize: "landscape_16_9",
        customWidth: 1024,
        customHeight: 1024,
      }),
    ).toBe("16 / 9");
  });

  it("prioritizes custom > preset > aspectRatio when multiple signals are set", () => {
    // Custom mode beats both preset and aspectRatio.
    expect(
      falImageConfiguredAspect({
        imageSizeMode: "custom",
        customWidth: 800,
        customHeight: 600,
        imageSize: "square_hd",
        aspectRatio: "9:16",
      }),
    ).toBe("800 / 600");
    // Preset beats aspectRatio when no custom.
    expect(
      falImageConfiguredAspect({
        imageSize: "portrait_16_9",
        aspectRatio: "16:9",
      }),
    ).toBe("9 / 16");
  });

  it("falls back to '1 / 1' for an empty / malformed config", () => {
    expect(falImageConfiguredAspect({})).toBe("1 / 1");
    expect(falImageConfiguredAspect({ aspectRatio: "" })).toBe("1 / 1");
    expect(falImageConfiguredAspect({ aspectRatio: "garbage" })).toBe("1 / 1");
    expect(
      falImageConfiguredAspect({
        imageSizeMode: "custom",
        customWidth: 0,
        customHeight: 0,
      }),
    ).toBe("1 / 1");
    expect(
      falImageConfiguredAspect({
        imageSizeMode: "custom",
        customWidth: -100,
        customHeight: 100,
      }),
    ).toBe("1 / 1");
  });
});
