import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { listNodeSchema } from "@/components/nodes/node-list";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { StandardizedOutput } from "@/types/node";

beforeEach(() => {
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

const makeTextItems = (...vals: string[]): StandardizedOutput[] =>
  vals.map((value) => ({ type: "text", value }));

describe("listNodeSchema", () => {
  it("declares the expected shape (NOT iterator — emits one item)", () => {
    expect(listNodeSchema.kind).toBe("list");
    expect(listNodeSchema.category).toBe("transform");
    expect(listNodeSchema.iterator).toBeFalsy();
    expect(listNodeSchema.inputs).toHaveLength(2);
    expect(listNodeSchema.inputs[0]?.id).toBe("items");
    expect(listNodeSchema.inputs[0]?.dataType).toBe("any");
    expect(listNodeSchema.inputs[1]?.id).toBe("cursor");
    expect(listNodeSchema.inputs[1]?.dataType).toBe("number");
    // Slice 6.4 hotfix — text-typed output (text-blue handle) since the
    // dominant flow is `text-array → list → llm-text.user`. See header
    // comment in node-list.tsx for the trade-off vs. "any".
    expect(listNodeSchema.outputs[0]?.dataType).toBe("text");
  });

  it("fixed mode emits items[cursor] and does not mutate cursor", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n",
          kind: "list",
          position: { x: 0, y: 0 },
          config: { cursor: 1, mode: "fixed" },
        },
      ],
    });
    const out = await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 1, mode: "fixed" },
      inputs: { items: makeTextItems("a", "b", "c") },
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ type: "text", value: "b" });
    expect(
      (useWorkflowStore.getState().nodes[0]!.config as { cursor: number })
        .cursor,
    ).toBe(1);
  });

  it("increment mode emits the current cursor item, then advances", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n",
          kind: "list",
          position: { x: 0, y: 0 },
          config: { cursor: 0, mode: "increment" },
        },
      ],
    });
    const out = await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 0, mode: "increment" },
      inputs: { items: makeTextItems("a", "b", "c") },
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ type: "text", value: "a" });
    expect(
      (useWorkflowStore.getState().nodes[0]!.config as { cursor: number })
        .cursor,
    ).toBe(1);
  });

  it("increment wraps around at the end of the array", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n",
          kind: "list",
          position: { x: 0, y: 0 },
          config: { cursor: 2, mode: "increment" },
        },
      ],
    });
    await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 2, mode: "increment" },
      inputs: { items: makeTextItems("a", "b", "c") },
      signal: new AbortController().signal,
    });
    expect(
      (useWorkflowStore.getState().nodes[0]!.config as { cursor: number })
        .cursor,
    ).toBe(0);
  });

  it("random mode picks via Math.random and persists cursor", async () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.66);
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n",
          kind: "list",
          position: { x: 0, y: 0 },
          config: { cursor: 0, mode: "random" },
        },
      ],
    });
    const out = await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 0, mode: "random" },
      inputs: { items: makeTextItems("a", "b", "c") },
      signal: new AbortController().signal,
    });
    // floor(0.66 * 3) = 1 → "b"
    expect(out).toEqual({ type: "text", value: "b" });
    spy.mockRestore();
  });

  it("external `cursor` input wins over internal cursor + mode", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n",
          kind: "list",
          position: { x: 0, y: 0 },
          config: { cursor: 0, mode: "increment" },
        },
      ],
    });
    const out = await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 0, mode: "increment" },
      inputs: {
        items: makeTextItems("a", "b", "c", "d"),
        cursor: { type: "number", value: 2 },
      },
      signal: new AbortController().signal,
    });
    // External cursor 2 → "c". Internal cursor untouched.
    expect(out).toEqual({ type: "text", value: "c" });
    expect(
      (useWorkflowStore.getState().nodes[0]!.config as { cursor: number })
        .cursor,
    ).toBe(0);
  });

  it("external cursor wraps via clamp (negative + over-array)", async () => {
    const out1 = await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 0, mode: "fixed" },
      inputs: {
        items: makeTextItems("a", "b", "c"),
        cursor: { type: "number", value: -1 },
      },
      signal: new AbortController().signal,
    });
    expect(out1).toEqual({ type: "text", value: "c" });

    const out2 = await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 0, mode: "fixed" },
      inputs: {
        items: makeTextItems("a", "b", "c"),
        cursor: { type: "number", value: 10 },
      },
      signal: new AbortController().signal,
    });
    // 10 % 3 = 1 → "b"
    expect(out2).toEqual({ type: "text", value: "b" });
  });

  it("empty upstream array returns []", async () => {
    const out = await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 0, mode: "fixed" },
      inputs: { items: [] },
      signal: new AbortController().signal,
    });
    expect(out).toEqual([]);
  });

  it("preserves the upstream type (image input → image output)", async () => {
    const out = await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 0, mode: "fixed" },
      inputs: {
        items: [
          { type: "image", value: { url: "https://x/1.png" } },
          { type: "image", value: { url: "https://x/2.png" } },
        ],
      },
      signal: new AbortController().signal,
    });
    expect(out).toEqual({
      type: "image",
      value: { url: "https://x/1.png" },
    });
  });

  it("body renders mode picker + cursor", () => {
    const Body = listNodeSchema.Body;
    render(
      <Body
        nodeId="n"
        config={{ cursor: 1, mode: "increment" }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    expect(screen.getByTestId("list-mode-chip").textContent).toBe(
      "increment",
    );
  });

  it("previews the selected media item (image thumbnail)", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "src", kind: "array", position: { x: 0, y: 0 }, config: {} },
        { id: "n", kind: "list", position: { x: 0, y: 0 }, config: { cursor: 1, mode: "fixed" } },
      ],
      edges: [
        { id: "e", source: "src", sourceHandle: "out", target: "n", targetHandle: "items" },
      ],
    });
    useExecutionStore.setState({
      records: new Map([
        [
          "src",
          {
            status: "done",
            output: [
              { type: "image", value: { url: "https://x/a.png" } },
              { type: "image", value: { url: "https://x/b.png" } },
            ],
          },
        ],
      ]),
    });
    const Body = listNodeSchema.Body;
    render(
      <Body
        nodeId="n"
        config={{ cursor: 1, mode: "fixed" }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    const img = screen.getByAltText("Selected") as HTMLImageElement;
    expect(img.src).toContain("https://x/b.png");
  });
});
