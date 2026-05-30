import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { compareNodeSchema } from "@/components/nodes/node-compare";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { StandardizedOutput } from "@/types/node";

beforeEach(() => {
  useWorkflowStore.setState({ nodes: [], edges: [] });
  useExecutionStore.setState({ records: new Map() });
});
afterEach(() => cleanup());

function wire(handle: string, sourceId: string, output: StandardizedOutput) {
  const ws = useWorkflowStore.getState();
  useWorkflowStore.setState({
    nodes: [...ws.nodes, { id: sourceId, kind: "video", position: { x: 0, y: 0 }, config: {} }],
    edges: [
      ...ws.edges,
      { id: `e-${handle}`, source: sourceId, sourceHandle: "out", target: "cmp", targetHandle: handle },
    ],
  });
  const recs = new Map(useExecutionStore.getState().records);
  recs.set(sourceId, { status: "done", output });
  useExecutionStore.setState({ records: recs });
}

describe("compare node", () => {
  it("is a reactive compose node with A/B inputs", () => {
    expect(compareNodeSchema.kind).toBe("compare");
    expect(compareNodeSchema.category).toBe("compose");
    expect(compareNodeSchema.reactive).toBe(true);
    expect(compareNodeSchema.inputs.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("execute passes input B through (falls back to A)", async () => {
    const a: StandardizedOutput = { type: "video", value: { url: "https://x/a.mp4" } };
    const b: StandardizedOutput = { type: "video", value: { url: "https://x/b.mp4" } };
    const out = (await compareNodeSchema.execute!({
      nodeId: "cmp",
      config: {},
      inputs: { a, b },
      signal: new AbortController().signal,
    } as never)) as StandardizedOutput;
    expect(out).toEqual(b);

    const outA = (await compareNodeSchema.execute!({
      nodeId: "cmp",
      config: {},
      inputs: { a },
      signal: new AbortController().signal,
    } as never)) as StandardizedOutput;
    expect(outA).toEqual(a);
  });

  it("renders both layers + the wipe divider when A and B are wired", () => {
    useWorkflowStore.setState({
      nodes: [{ id: "cmp", kind: "compare", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    });
    wire("a", "srcA", { type: "video", value: { url: "https://x/a.mp4" } });
    wire("b", "srcB", { type: "image", value: { url: "https://x/b.png" } });

    const Body = compareNodeSchema.Body;
    render(<Body nodeId="cmp" config={{}} updateConfig={vi.fn()} selected={false} />);

    expect(screen.getByTestId("compare-a")).toBeTruthy();
    expect(screen.getByTestId("compare-b")).toBeTruthy();
    const stage = screen.getByTestId("compare-stage");
    // Moving the mouse changes the reveal without throwing.
    expect(() => fireEvent.mouseMove(stage, { clientX: 100 })).not.toThrow();
  });
});
