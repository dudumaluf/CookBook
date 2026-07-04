import { beforeEach, describe, expect, it, vi } from "vitest";

const { callGeminiOmni } = vi.hoisted(() => ({
  callGeminiOmni: vi.fn(),
}));
vi.mock("@/lib/fal/call-gemini-omni", () => ({ callGeminiOmni }));

import { geminiOmniNodeSchema } from "@/components/nodes/node-fal-gemini-omni";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type Cfg = Parameters<NonNullable<typeof geminiOmniNodeSchema.execute>>[0];

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
  callGeminiOmni.mockReset();
  callGeminiOmni.mockResolvedValue({
    videoUrl: "https://cdn.fal.media/omni.mp4",
    mime: "video/mp4",
    model: "google/gemini-omni-flash/reference-to-video",
  });
});

describe("gemini-omni-video node execute", () => {
  it("throws when no prompt is wired", async () => {
    await expect(
      geminiOmniNodeSchema.execute!(
        ctx({ "image-0": { type: "image", value: { url: "https://x/a.png" } } }) as Cfg,
      ),
    ).rejects.toThrow(/needs a prompt/i);
    expect(callGeminiOmni).not.toHaveBeenCalled();
  });

  it("throws when a prompt is wired but no reference image", async () => {
    await expect(
      geminiOmniNodeSchema.execute!(
        ctx({ prompt: { type: "text", value: "a cat" } }) as Cfg,
      ),
    ).rejects.toThrow(/at least one reference image/i);
    expect(callGeminiOmni).not.toHaveBeenCalled();
  });

  it("generates from a prompt + one image and emits a video output", async () => {
    const result = await geminiOmniNodeSchema.execute!(
      ctx({
        prompt: { type: "text", value: "a cat batting yarn" },
        "image-0": { type: "image", value: { url: "https://x/cat.png" } },
      }) as Cfg,
    );
    expect(callGeminiOmni).toHaveBeenCalledTimes(1);
    const arg = callGeminiOmni.mock.calls[0]![0];
    expect(arg.prompt).toBe("a cat batting yarn");
    expect(arg.imageUrls).toEqual(["https://x/cat.png"]);
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://cdn.fal.media/omni.mp4");
    }
  });

  it("forwards numbered reference sockets in order (image-0, image-1, …)", async () => {
    await geminiOmniNodeSchema.execute!(
      ctx({
        prompt: { type: "text", value: "put <IMAGE_REF_0> next to <IMAGE_REF_1>" },
        "image-0": { type: "image", value: { url: "https://x/a.png" } },
        "image-1": { type: "image", value: { url: "https://x/b.png" } },
      }) as Cfg,
    );
    const arg = callGeminiOmni.mock.calls[0]![0];
    expect(arg.imageUrls).toEqual(["https://x/a.png", "https://x/b.png"]);
  });

  it("fans an image array wired into <IMAGE_REF[]> after numbered sockets", async () => {
    await geminiOmniNodeSchema.execute!(
      ctx({
        prompt: { type: "text", value: "morph" },
        "image-0": { type: "image", value: { url: "https://x/first.png" } },
        image: [
          { type: "image", value: { url: "https://x/k1.png" } },
          { type: "image", value: { url: "https://x/k2.png" } },
        ],
      }) as Cfg,
    );
    const arg = callGeminiOmni.mock.calls[0]![0];
    expect(arg.imageUrls).toEqual([
      "https://x/first.png",
      "https://x/k1.png",
      "https://x/k2.png",
    ]);
  });

  it("caps the reference images at the Fal maximum", async () => {
    await geminiOmniNodeSchema.execute!(
      ctx({
        prompt: { type: "text", value: "many" },
        image: [
          { type: "image", value: { url: "https://x/1.png" } },
          { type: "image", value: { url: "https://x/2.png" } },
          { type: "image", value: { url: "https://x/3.png" } },
          { type: "image", value: { url: "https://x/4.png" } },
          { type: "image", value: { url: "https://x/5.png" } },
          { type: "image", value: { url: "https://x/6.png" } },
        ],
      }) as Cfg,
    );
    const arg = callGeminiOmni.mock.calls[0]![0];
    expect(arg.imageUrls).toHaveLength(4);
  });

  it("sends the configured aspect ratio + duration", async () => {
    await geminiOmniNodeSchema.execute!(
      ctx(
        {
          prompt: { type: "text", value: "portrait clip" },
          "image-0": { type: "image", value: { url: "https://x/a.png" } },
        },
        { aspectRatio: "9:16", duration: 5 },
      ) as Cfg,
    );
    const arg = callGeminiOmni.mock.calls[0]![0];
    expect(arg.aspectRatio).toBe("9:16");
    expect(arg.duration).toBe(5);
  });

  it("defaults aspect ratio to 16:9 and duration to 8", async () => {
    await geminiOmniNodeSchema.execute!(
      ctx({
        prompt: { type: "text", value: "x" },
        "image-0": { type: "image", value: { url: "https://x/a.png" } },
      }) as Cfg,
    );
    const arg = callGeminiOmni.mock.calls[0]![0];
    expect(arg.aspectRatio).toBe("16:9");
    expect(arg.duration).toBe(8);
  });

  it("throws in edit mode when no source video is wired", async () => {
    await expect(
      geminiOmniNodeSchema.execute!(
        ctx(
          { prompt: { type: "text", value: "Make this anime." } },
          { mode: "edit" },
        ) as Cfg,
      ),
    ).rejects.toThrow(/source video/i);
    expect(callGeminiOmni).not.toHaveBeenCalled();
  });

  it("edits a source video from prompt + video socket", async () => {
    callGeminiOmni.mockResolvedValueOnce({
      videoUrl: "https://cdn.fal.media/omni-edited.mp4",
      mime: "video/mp4",
      model: "google/gemini-omni-flash/edit",
    });

    const result = await geminiOmniNodeSchema.execute!(
      ctx(
        {
          prompt: {
            type: "text",
            value: "Make this video anime. Keep everything else the same.",
          },
          video: {
            type: "video",
            value: { url: "https://x/source.mp4" },
          },
        },
        { mode: "edit" },
      ) as Cfg,
    );

    expect(callGeminiOmni).toHaveBeenCalledTimes(1);
    const arg = callGeminiOmni.mock.calls[0]![0];
    expect(arg.mode).toBe("edit");
    expect(arg.prompt).toMatch(/anime/i);
    expect(arg.videoUrl).toBe("https://x/source.mp4");
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("video");
    if (out.type === "video") {
      expect(out.value.url).toBe("https://cdn.fal.media/omni-edited.mp4");
    }
  });
});

describe("gemini-omni-video node schema", () => {
  it("exposes prompt + one numbered image socket + the array socket by default", () => {
    const io = geminiOmniNodeSchema.getInputs!({});
    expect(io.map((h) => h.id)).toEqual(["prompt", "image-0", "image"]);
  });

  it("auto-grows numbered image sockets up to the cap", () => {
    const grown = geminiOmniNodeSchema.getInputs!({ imagePorts: 3 });
    expect(grown.map((h) => h.id)).toEqual([
      "prompt",
      "image-0",
      "image-1",
      "image-2",
      "image",
    ]);
    const capped = geminiOmniNodeSchema.getInputs!({ imagePorts: 99 });
    expect(capped.filter((h) => h.id.startsWith("image-")).length).toBe(4);
  });

  it("labels each numbered socket with its <IMAGE_REF_N> prompt tag", () => {
    const io = geminiOmniNodeSchema.getInputs!({ imagePorts: 2 });
    const byId = Object.fromEntries(io.map((h) => [h.id, h.label]));
    expect(byId["image-0"]).toBe("<IMAGE_REF_0>");
    expect(byId["image-1"]).toBe("<IMAGE_REF_1>");
  });

  it("exposes a single multiple image-array socket (<IMAGE_REF[]>)", () => {
    const io = geminiOmniNodeSchema.getInputs!({});
    const arr = io.filter((h) => h.id === "image");
    expect(arr).toHaveLength(1);
    expect(arr[0]?.multiple).toBe(true);
    expect(arr[0]?.label).toBe("<IMAGE_REF[]>");
    expect(arr[0]?.dataType).toBe("image");
  });

  it("is registered as a non-reactive ai-video node emitting video", () => {
    expect(geminiOmniNodeSchema.kind).toBe("gemini-omni-video");
    expect(geminiOmniNodeSchema.category).toBe("ai-video");
    expect(geminiOmniNodeSchema.reactive).toBe(false);
    expect(geminiOmniNodeSchema.outputs[0]?.dataType).toBe("video");
  });

  it("exposes prompt + video sockets in edit mode", () => {
    const io = geminiOmniNodeSchema.getInputs!({ mode: "edit" });
    expect(io.map((h) => h.id)).toEqual(["prompt", "video"]);
    expect(io.find((h) => h.id === "video")?.dataType).toBe("video");
  });

  it("defaults to reference mode inputs", () => {
    const io = geminiOmniNodeSchema.getInputs!({});
    expect(io.some((h) => h.id.startsWith("image-"))).toBe(true);
    expect(io.some((h) => h.id === "video")).toBe(false);
  });
});
