import { beforeEach, describe, expect, it, vi } from "vitest";

const { callTelestyleV2, uploadImageFromUrl } = vi.hoisted(() => ({
  callTelestyleV2: vi.fn(),
  uploadImageFromUrl: vi.fn(),
}));
vi.mock("@/lib/fal/call-telestyle-v2", () => ({ callTelestyleV2 }));
vi.mock("@/lib/library/upload-asset", () => ({ uploadImageFromUrl }));

import {
  hasTelestyleV2Overrides,
  telestyleV2NodeSchema,
} from "@/components/nodes/node-fal-telestyle-v2";
import type { ExecContext, StandardizedOutput } from "@/types/node";

const img = (url: string): StandardizedOutput => ({
  type: "image",
  value: { url },
});

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
  callTelestyleV2.mockReset();
  uploadImageFromUrl.mockReset();
  callTelestyleV2.mockResolvedValue({
    imageUrl: "https://fal/styled.png",
    mime: "image/png",
    prompt: "a watercolor portrait",
    seed: 42,
    model: "fal-ai/telestyle-v2",
  });
  uploadImageFromUrl.mockResolvedValue({ url: "https://cdn/telestyle-v2.png" });
});

describe("telestyle-v2 node execute", () => {
  it("throws when no content image is wired", async () => {
    await expect(
      telestyleV2NodeSchema.execute!(
        ctx({ style: img("https://x/s.png") }) as never,
      ),
    ).rejects.toThrow(/CONTENT image/);
  });

  it("throws when no style image is wired", async () => {
    await expect(
      telestyleV2NodeSchema.execute!(
        ctx({ content: img("https://x/c.png") }) as never,
      ),
    ).rejects.toThrow(/STYLE image/);
  });

  it("calls Fal with both images and emits a re-hosted image", async () => {
    const result = await telestyleV2NodeSchema.execute!(
      ctx({
        content: img("https://x/c.png"),
        style: img("https://x/s.png"),
      }) as never,
    );
    expect(callTelestyleV2).toHaveBeenCalledWith(
      expect.objectContaining({
        contentImageUrl: "https://x/c.png",
        styleImageUrl: "https://x/s.png",
      }),
    );
    expect(uploadImageFromUrl).toHaveBeenCalledWith(
      "https://fal/styled.png",
      expect.stringContaining("telestyle-v2"),
    );
    const out = (result as { output: StandardizedOutput }).output;
    expect(out.type).toBe("image");
    if (out.type === "image") {
      expect(out.value.url).toBe("https://cdn/telestyle-v2.png");
      expect(out.value.mime).toBe("image/png");
    }
  });

  it("passes a configured loraScale + outputFormat through to the wrapper", async () => {
    await telestyleV2NodeSchema.execute!(
      ctx(
        {
          content: img("https://x/c.png"),
          style: img("https://x/s.png"),
        },
        { loraScale: 0.6, outputFormat: "jpeg" },
      ) as never,
    );
    expect(callTelestyleV2).toHaveBeenCalledWith(
      expect.objectContaining({ loraScale: 0.6, outputFormat: "jpeg" }),
    );
  });

  it("omits loraScale / outputFormat when unset (Fal defaults apply)", async () => {
    await telestyleV2NodeSchema.execute!(
      ctx({
        content: img("https://x/c.png"),
        style: img("https://x/s.png"),
      }) as never,
    );
    const arg = callTelestyleV2.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("loraScale");
    expect(arg).not.toHaveProperty("outputFormat");
  });

  it("is a non-reactive ai-image node with content + style in and one image out", () => {
    expect(telestyleV2NodeSchema.kind).toBe("fal-telestyle-v2");
    expect(telestyleV2NodeSchema.category).toBe("ai-image");
    expect(telestyleV2NodeSchema.reactive).toBe(false);
    expect(telestyleV2NodeSchema.inputs.map((i) => i.id)).toEqual([
      "content",
      "style",
    ]);
    expect(telestyleV2NodeSchema.inputs.every((i) => i.dataType === "image")).toBe(
      true,
    );
    expect(telestyleV2NodeSchema.outputs[0]?.dataType).toBe("image");
  });
});

describe("hasTelestyleV2Overrides", () => {
  it("is false by default and true once a non-default knob is set", () => {
    expect(hasTelestyleV2Overrides({})).toBe(false);
    expect(hasTelestyleV2Overrides({ loraScale: 1 })).toBe(false);
    expect(hasTelestyleV2Overrides({ outputFormat: "png" })).toBe(false);
    expect(hasTelestyleV2Overrides({ loraScale: 0.5 })).toBe(true);
    expect(hasTelestyleV2Overrides({ outputFormat: "jpeg" })).toBe(true);
  });
});
