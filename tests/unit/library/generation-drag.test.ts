import { describe, expect, it } from "vitest";

import {
  GENERATION_DRAG_MIME,
  parseGenerationDrag,
  serializeGenerationDrag,
} from "@/lib/library/generation-drag";

describe("generation-drag", () => {
  it("MIME is the cookbook-namespaced custom type", () => {
    expect(GENERATION_DRAG_MIME).toBe("application/x-cookbook-generation");
  });

  it("serialize / parse roundtrips a single image item", () => {
    const payload = {
      items: [
        {
          generationId: "g1",
          output: {
            type: "image" as const,
            value: { url: "https://x.test/a.png" },
          },
        },
      ],
    };
    const wire = serializeGenerationDrag(payload);
    const parsed = parseGenerationDrag(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.items).toHaveLength(1);
    expect(parsed!.items[0]!.generationId).toBe("g1");
    expect(parsed!.items[0]!.output.type).toBe("image");
  });

  it("serialize / parse roundtrips multi-select with mixed kinds", () => {
    const wire = serializeGenerationDrag({
      items: [
        {
          generationId: "g1",
          output: { type: "image", value: { url: "https://x.test/1.png" } },
        },
        {
          generationId: "g2",
          output: { type: "text", value: "Hello world" },
        },
      ],
    });
    const parsed = parseGenerationDrag(wire);
    expect(parsed!.items).toHaveLength(2);
    expect(parsed!.items[0]!.output.type).toBe("image");
    expect(parsed!.items[1]!.output.type).toBe("text");
  });

  it("returns null on malformed JSON", () => {
    expect(parseGenerationDrag("not-json")).toBeNull();
  });

  it("returns null on missing items array", () => {
    expect(parseGenerationDrag(JSON.stringify({ foo: 1 }))).toBeNull();
  });

  it("returns null when all items fail validation", () => {
    expect(
      parseGenerationDrag(
        JSON.stringify({ items: [{ generationId: "", output: {} }] }),
      ),
    ).toBeNull();
  });
});
