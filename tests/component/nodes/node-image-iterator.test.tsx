import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { imageIteratorNodeSchema } from "@/components/nodes/node-image-iterator";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { StandardizedOutput, WorkflowEdge } from "@/types/node";

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

  /* ──────────────────── Slice 5.4: live edge count ──────────────────── */

  describe("live edge count in body", () => {
    // Reset the workflow-store between tests so leftover edges from one
    // case don't leak into the next.
    beforeEach(() => {
      useWorkflowStore.setState({ nodes: [], edges: [] });
    });
    afterEach(() => {
      useWorkflowStore.setState({ nodes: [], edges: [] });
    });

    function seedEdges(edges: WorkflowEdge[]) {
      useWorkflowStore.setState({ edges });
    }

    it("shows the empty-state copy when no edges are wired into the `images` handle", () => {
      const Body = imageIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={{}}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const status = screen.getByTestId("image-iterator-count");
      expect(status.textContent).toMatch(/no images connected/i);
      // Forward-compat footnote pointing at Slice 5.5 redesign.
      expect(
        screen.getByText(/drop images directly into this node/i),
      ).toBeInTheDocument();
    });

    it("counts only edges targeting THIS iterator's `images` handle (not unrelated edges)", () => {
      seedEdges([
        // Three edges into our iterator's `images` handle.
        {
          id: "e1",
          source: "src-1",
          sourceHandle: "out",
          target: "iter-1",
          targetHandle: "images",
        },
        {
          id: "e2",
          source: "src-2",
          sourceHandle: "out",
          target: "iter-1",
          targetHandle: "images",
        },
        {
          id: "e3",
          source: "src-3",
          sourceHandle: "out",
          target: "iter-1",
          targetHandle: "images",
        },
        // Edge into a different iterator — should not count.
        {
          id: "e4",
          source: "src-4",
          sourceHandle: "out",
          target: "iter-other",
          targetHandle: "images",
        },
        // Edge from our iterator's *output* to something downstream —
        // should not count (we only care about edges targeting the
        // `images` input handle).
        {
          id: "e5",
          source: "iter-1",
          sourceHandle: "out",
          target: "downstream",
          targetHandle: "image",
        },
      ]);

      const Body = imageIteratorNodeSchema.Body;
      render(
        <Body
          nodeId="iter-1"
          config={{}}
          updateConfig={() => undefined}
          selected={false}
        />,
      );
      const status = screen.getByTestId("image-iterator-count");
      expect(status.textContent).toMatch(/3 images connected/i);
      // Plural-aware copy mentions parallel fan-out so the user knows
      // what's about to happen.
      expect(status.textContent).toMatch(/parallel/i);
    });
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
