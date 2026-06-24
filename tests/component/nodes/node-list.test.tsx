import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  __testHooks as listTestHooks,
  listNodeSchema,
} from "@/components/nodes/node-list";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { StandardizedOutput } from "@/types/node";

beforeEach(() => {
  useWorkflowStore.setState({ nodes: [], edges: [] });
  useExecutionStore.setState({ records: new Map() });
});

const makeTextItems = (...vals: string[]): StandardizedOutput[] =>
  vals.map((value) => ({ type: "text", value }));

describe("listNodeSchema", () => {
  it("declares the expected shape (NOT iterator — emits one item)", () => {
    expect(listNodeSchema.kind).toBe("list");
    expect(listNodeSchema.category).toBe("transform");
    expect(listNodeSchema.iterator).toBeFalsy();
    // Slice 6.5 — baseline inputs are `[items, slot-0, cursor]`. The
    // slot list grows dynamically via getInputs(config.slotCount) up to
    // MAX_SLOTS = 8. The drive handle's id stays `cursor` for back-compat
    // (existing edges / recipes), but its LABEL reads "index" (ADR-0077).
    expect(listNodeSchema.inputs).toHaveLength(3);
    expect(listNodeSchema.inputs[0]?.id).toBe("items");
    expect(listNodeSchema.inputs[0]?.dataType).toBe("any");
    expect(listNodeSchema.inputs[1]?.id).toBe("slot-0");
    expect(listNodeSchema.inputs[1]?.dataType).toBe("any");
    expect(listNodeSchema.inputs[2]?.id).toBe("cursor");
    expect(listNodeSchema.inputs[2]?.dataType).toBe("number");
    expect(listNodeSchema.inputs[2]?.label).toBe("index");
    // configParam label is relabelled too (id/key stay `cursor`).
    expect(listNodeSchema.configParams?.cursor?.label).toBe("index");
    // Slice 6.4 hotfix — text-typed output (text-blue handle) since the
    // dominant flow is `text-array → list → llm-text.user`. See header
    // comment in node-list.tsx for the trade-off vs. "any".
    expect(listNodeSchema.outputs[0]?.dataType).toBe("text");
  });

  it("getInputs grows slot ports from slotCount, capped at MAX_SLOTS, ordered items → slots → cursor", () => {
    const four = listNodeSchema.getInputs!({
      cursor: 0,
      mode: "fixed",
      slotCount: 4,
    });
    expect(four.map((p) => p.id)).toEqual([
      "items",
      "slot-0",
      "slot-1",
      "slot-2",
      "slot-3",
      "cursor",
    ]);

    // Cap at MAX_SLOTS even when config asks for more.
    const overflow = listNodeSchema.getInputs!({
      cursor: 0,
      mode: "fixed",
      slotCount: 999,
    });
    const slotIds = overflow
      .map((p) => p.id)
      .filter((id) => id.startsWith("slot-"));
    expect(slotIds).toHaveLength(listTestHooks.MAX_SLOTS);
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

  it("execute concatenates `items` array + wired `slot-N` inputs (cursor indexes the union)", async () => {
    // 2 items via array + 2 items via slots → 4 total. cursor=2 picks
    // the FIRST slot item (index 2 in the union).
    const out = await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 2, mode: "fixed", slotCount: 3 },
      inputs: {
        items: makeTextItems("a", "b"),
        "slot-0": { type: "text", value: "slot-A" },
        "slot-1": { type: "text", value: "slot-B" },
      },
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ type: "text", value: "slot-A" });
  });

  it("execute uses ONLY slot inputs when `items` is empty (smart-input-only flow)", async () => {
    const out = await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 1, mode: "fixed", slotCount: 3 },
      inputs: {
        "slot-0": { type: "image", value: { url: "https://x/a.png" } },
        "slot-1": { type: "image", value: { url: "https://x/b.png" } },
      },
      signal: new AbortController().signal,
    });
    expect(out).toEqual({
      type: "image",
      value: { url: "https://x/b.png" },
    });
  });

  it("execute takes only the FIRST item from a slot whose upstream emits an array", async () => {
    // Slots are the "single-item" affordance — wiring a fan-out source
    // into a slot collapses to its head; the user is expected to use
    // the `items` port for true array fan-in.
    const out = await listNodeSchema.execute!({
      nodeId: "n",
      config: { cursor: 0, mode: "fixed", slotCount: 2 },
      inputs: {
        "slot-0": [
          { type: "text", value: "head" },
          { type: "text", value: "tail" },
        ],
      },
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ type: "text", value: "head" });
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

  it("body picker shows the UNION of `items` array + wired slot upstreams (in order)", () => {
    // Two upstream sources:
    //   src-arr  → array of 2 texts wired into `items`
    //   src-slot → single text wired into `slot-0`
    // Expected picker order: [arr-0, arr-1, slot-text]
    useWorkflowStore.setState({
      nodes: [
        { id: "src-arr", kind: "array", position: { x: 0, y: 0 }, config: {} },
        {
          id: "src-slot",
          kind: "text",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "n",
          kind: "list",
          position: { x: 0, y: 0 },
          config: { cursor: 0, mode: "fixed", slotCount: 2 },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "src-arr",
          sourceHandle: "out",
          target: "n",
          targetHandle: "items",
        },
        {
          id: "e2",
          source: "src-slot",
          sourceHandle: "out",
          target: "n",
          targetHandle: "slot-0",
        },
      ],
    });
    useExecutionStore.setState({
      records: new Map([
        [
          "src-arr",
          {
            status: "done",
            output: [
              { type: "text", value: "alpha" },
              { type: "text", value: "beta" },
            ],
          },
        ],
        [
          "src-slot",
          {
            status: "done",
            output: { type: "text", value: "from-slot" },
          },
        ],
      ]),
    });

    const Body = listNodeSchema.Body;
    render(
      <Body
        nodeId="n"
        config={{ cursor: 0, mode: "fixed", slotCount: 2 }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );

    const picker = screen.getByTestId("list-item-picker") as HTMLSelectElement;
    const labels = Array.from(picker.options).map((o) => o.textContent ?? "");
    // Array entries come first (in their natural order), then slot
    // entries by port index.
    expect(labels).toEqual(["0. alpha", "1. beta", "2. from-slot"]);
  });

  it("body auto-grows slotCount to maxConnectedSlot + 2 when a slot gets wired", () => {
    // Wire something into slot-1 with current slotCount=1 — body
    // should call updateConfig({ slotCount: 3 }) so there's still one
    // empty trailing slot.
    useWorkflowStore.setState({
      nodes: [
        {
          id: "src",
          kind: "text",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "n",
          kind: "list",
          position: { x: 0, y: 0 },
          config: { cursor: 0, mode: "fixed", slotCount: 1 },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "src",
          sourceHandle: "out",
          target: "n",
          targetHandle: "slot-1",
        },
      ],
    });

    const updateConfig = vi.fn();
    const Body = listNodeSchema.Body;
    render(
      <Body
        nodeId="n"
        config={{ cursor: 0, mode: "fixed", slotCount: 1 }}
        updateConfig={updateConfig}
        selected={false}
      />,
    );
    expect(updateConfig).toHaveBeenCalledWith({ slotCount: 3 });
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
