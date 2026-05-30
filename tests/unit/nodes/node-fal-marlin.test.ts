import { beforeEach, describe, expect, it, vi } from "vitest";

const { callMarlin } = vi.hoisted(() => ({ callMarlin: vi.fn() }));
vi.mock("@/lib/fal/call-marlin", () => ({ callMarlin }));

import { marlinNodeSchema } from "@/components/nodes/node-fal-marlin";
import { MARLIN_DEFAULT_PROMPT } from "@/lib/fal/types";
import type { ExecContext, StandardizedOutput } from "@/types/node";

type CtxArgs = Parameters<NonNullable<typeof marlinNodeSchema.execute>>[0];

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
  callMarlin.mockReset();
  callMarlin.mockResolvedValue({
    scene: "Indoor kitchen, daytime.",
    events: [{ start: 0, end: 1.5, text: "a person waves" }],
    text: "Scene: Indoor kitchen, daytime.\nEvents: 0-1.5 a person waves",
    model: "fal-ai/marlin",
  });
});

describe("marlin node execute", () => {
  it("throws when no video is wired", async () => {
    await expect(
      marlinNodeSchema.execute!(ctx({}) as CtxArgs),
    ).rejects.toThrow(/video/);
  });

  it("calls Fal with the canonical default prompt when nothing overrides it", async () => {
    await marlinNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/clip.mp4" } },
      }) as CtxArgs,
    );
    expect(callMarlin).toHaveBeenCalledWith(
      expect.objectContaining({
        videoUrl: "https://x/clip.mp4",
        prompt: MARLIN_DEFAULT_PROMPT,
      }),
    );
  });

  it("prefers a wired prompt input over config or default", async () => {
    await marlinNodeSchema.execute!(
      ctx(
        {
          video: { type: "video", value: { url: "https://x/clip.mp4" } },
          prompt: { type: "text", value: "from-input" },
        },
        { prompt: "from-config" },
      ) as CtxArgs,
    );
    expect(callMarlin).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "from-input" }),
    );
  });

  it("falls back to config prompt when no input is wired", async () => {
    await marlinNodeSchema.execute!(
      ctx(
        {
          video: { type: "video", value: { url: "https://x/clip.mp4" } },
        },
        { prompt: "  describe the dance  " },
      ) as CtxArgs,
    );
    expect(callMarlin).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "  describe the dance  " }),
    );
  });

  it("emits the full caption text as the standardized output", async () => {
    const result = await marlinNodeSchema.execute!(
      ctx({
        video: { type: "video", value: { url: "https://x/clip.mp4" } },
      }) as CtxArgs,
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("text");
    if (out.type === "text") {
      expect(out.value).toMatch(/Scene/);
    }
  });

  it("forwards sampling + max-tokens config", async () => {
    await marlinNodeSchema.execute!(
      ctx(
        {
          video: { type: "video", value: { url: "https://x/clip.mp4" } },
        },
        {
          maxTokens: 1024,
          doSample: true,
          temperature: 0.7,
          topP: 0.9,
        },
      ) as CtxArgs,
    );
    expect(callMarlin).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 1024,
        doSample: true,
        temperature: 0.7,
        topP: 0.9,
      }),
    );
  });

  it("is a non-reactive ai-vision node with text output", () => {
    expect(marlinNodeSchema.kind).toBe("fal-marlin");
    expect(marlinNodeSchema.category).toBe("ai-vision");
    expect(marlinNodeSchema.reactive).toBe(false);
    expect(marlinNodeSchema.outputs[0]?.dataType).toBe("text");
    expect(marlinNodeSchema.inputs.map((i) => i.id)).toEqual([
      "video",
      "prompt",
    ]);
  });
});
