import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { imageIteratorNodeSchema } from "@/components/nodes/node-image-iterator";
import type { StandardizedOutput } from "@/types/node";

describe("imageIteratorNodeSchema", () => {
  it("declares the expected schema shape", () => {
    expect(imageIteratorNodeSchema.kind).toBe("image-iterator");
    expect(imageIteratorNodeSchema.category).toBe("iterator");
    expect(imageIteratorNodeSchema.reactive).toBe(true);
    // The magic flag — without this the engine would just hand the
    // array to the downstream as the input value, which on a single
    // input handle would only ever take the first item.
    expect(imageIteratorNodeSchema.iterator).toBe(true);

    expect(imageIteratorNodeSchema.inputs).toEqual([
      { id: "images", label: "images", dataType: "image", multiple: true },
    ]);
    expect(imageIteratorNodeSchema.outputs[0]).toEqual({
      id: "out",
      label: "out",
      dataType: "image",
    });
  });

  it("declares horizontal-only resize (the body is a single explanatory row)", () => {
    expect(imageIteratorNodeSchema.size?.resizable).toBe("horizontal");
    expect(imageIteratorNodeSchema.size?.minWidth).toBeGreaterThan(0);
    expect(imageIteratorNodeSchema.size?.maxWidth).toBeGreaterThan(
      imageIteratorNodeSchema.size!.minWidth!,
    );
  });

  it("renders an explanatory hint in the body", () => {
    const Body = imageIteratorNodeSchema.Body;
    render(
      <Body
        nodeId="n1"
        config={{}}
        updateConfig={() => undefined}
        selected={false}
      />,
    );
    expect(
      screen.getByText(/wire n images here/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/parallel/i),
    ).toBeTruthy();
  });

  describe("execute()", () => {
    it("emits the wired upstream images as a flat array", async () => {
      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: {
          images: [
            { type: "image", value: { url: "https://x/1.png" } },
            { type: "image", value: { url: "https://x/2.png" } },
            { type: "image", value: { url: "https://x/3.png" } },
          ],
        },
        signal: new AbortController().signal,
      });

      expect(Array.isArray(result)).toBe(true);
      const arr = result as StandardizedOutput[];
      expect(arr).toHaveLength(3);
      expect(arr[0]).toEqual({
        type: "image",
        value: { url: "https://x/1.png" },
      });
    });

    it("returns an empty array when nothing is wired", async () => {
      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: {},
        signal: new AbortController().signal,
      });
      expect(result).toEqual([]);
    });

    it("filters out non-image inputs (defensive against type mismatches)", async () => {
      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: {
          images: [
            { type: "image", value: { url: "https://x/1.png" } },
            // Bogus shape — extractInputArrayByType drops it.
            { type: "text", value: "not an image" } as never,
            { type: "image", value: { url: "https://x/2.png" } },
          ],
        },
        signal: new AbortController().signal,
      });
      const arr = result as StandardizedOutput[];
      expect(arr).toHaveLength(2);
      expect(arr.map((o) => o.type)).toEqual(["image", "image"]);
    });

    it("normalises a single non-array upstream into a 1-item array", async () => {
      const result = await imageIteratorNodeSchema.execute!({
        nodeId: "n1",
        config: {},
        inputs: {
          images: { type: "image", value: { url: "https://x/solo.png" } },
        },
        signal: new AbortController().signal,
      });
      const arr = result as StandardizedOutput[];
      expect(arr).toHaveLength(1);
      expect(arr[0]).toEqual({
        type: "image",
        value: { url: "https://x/solo.png" },
      });
    });
  });
});
