import { describe, expect, it } from "vitest";

import { FAL_IMAGE_MODELS } from "@/lib/fal/types";
import { validateConfigPatch } from "@/lib/assistant/tools/construct/validate-config-patch";

describe("validateConfigPatch", () => {
  it("returns null for unrelated kinds even with a `model` field", () => {
    expect(
      validateConfigPatch("text", { text: "hello" }),
    ).toBeNull();
    expect(
      validateConfigPatch("llm-text", { model: "anything" }),
    ).toBeNull();
  });

  it("returns null for a fal-image patch without a `model` field", () => {
    expect(
      validateConfigPatch("fal-image", { seed: 42, numImages: 4 }),
    ).toBeNull();
  });

  it("accepts every model literal from FAL_IMAGE_MODELS", () => {
    for (const m of FAL_IMAGE_MODELS) {
      expect(validateConfigPatch("fal-image", { model: m })).toBeNull();
    }
  });

  it("rejects the Fal endpoint id (`fal-ai/<...>`) — the canonical bug case", () => {
    const err = validateConfigPatch("fal-image", {
      model: "fal-ai/nano-banana-2",
    });
    expect(err).toBeTruthy();
    expect(err).toContain("fal-image");
    expect(err).toContain("nano-banana-2");
  });

  it("rejects an entirely unknown model string with a useful message", () => {
    const err = validateConfigPatch("fal-image", { model: "totally-fake" });
    expect(err).toBeTruthy();
    expect(err).toContain("totally-fake");
  });

  it("rejects non-string `model` values", () => {
    const err = validateConfigPatch("fal-image", {
      model: 123 as unknown as string,
    });
    expect(err).toBeTruthy();
    expect(err).toContain("must be a string");
  });

  it("rejects array.separator with a hint pointing at delimiter", () => {
    const err = validateConfigPatch("array", { separator: "**" });
    expect(err).toBeTruthy();
    expect(err).toContain("array");
    expect(err).toContain("separator");
    expect(err).toContain("delimiter");
  });

  it("does not reject array.delimiter (the real field)", () => {
    expect(
      validateConfigPatch("array", { delimiter: "**", trim: true }),
    ).toBeNull();
  });
});
