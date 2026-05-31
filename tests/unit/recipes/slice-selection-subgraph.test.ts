import { beforeEach, describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";
import { sliceSelectionSubgraph } from "@/lib/recipes/slice-selection-subgraph";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * Slicer tests — extracted from `save-from-canvas.ts` so the assistant
 * (and any future analysis tooling) can reuse the slicing pass without
 * paying the recipe-save cost.
 *
 * Every test pins a small fixture so a regression here surfaces a
 * behavioral change (not a "the helper threw" mystery).
 */

function n(
  id: string,
  kind: string,
  config: Record<string, unknown> = {},
): NodeInstance {
  return { id, kind, position: { x: 0, y: 0 }, config };
}

function e(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): WorkflowEdge {
  return {
    id: `${source}_${sourceHandle}__${target}_${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  };
}

beforeEach(() => {
  // Registry populates as a side-effect of the all-nodes import.
});

describe("sliceSelectionSubgraph", () => {
  it("returns an empty slice when no nodes are selected", () => {
    const result = sliceSelectionSubgraph(
      [n("a", "text"), n("b", "text")],
      [],
      [],
    );
    expect(result.nodes).toHaveLength(0);
    expect(result.internalEdges).toHaveLength(0);
    expect(result.boundaryIncoming).toHaveLength(0);
    expect(result.boundaryOutgoing).toHaveLength(0);
    expect(result.exposedInputs).toHaveLength(0);
    expect(result.exposedOutputs).toHaveLength(0);
    expect(result.topologicalOrder).toEqual([]);
    expect(result.kindCounts).toEqual({});
  });

  it("single-node selection returns just the node, no edges", () => {
    const result = sliceSelectionSubgraph(
      [n("a", "text", { text: "hi" })],
      [],
      ["a"],
    );
    expect(result.nodes.map((x) => x.id)).toEqual(["a"]);
    expect(result.internalEdges).toEqual([]);
    expect(result.topologicalOrder).toEqual(["a"]);
    expect(result.kindCounts).toEqual({ text: 1 });
  });

  it("classifies internal vs boundary edges correctly", () => {
    // a → b (internal); ext → b (incoming); b → out (outgoing).
    const nodes = [n("a", "text"), n("b", "llm-text"), n("ext", "text"), n("out", "text")];
    const edges = [
      e("a", "out", "b", "user"),
      e("ext", "out", "b", "system"),
      e("b", "out", "out", "out"),
    ];
    const result = sliceSelectionSubgraph(nodes, edges, ["a", "b"]);
    expect(result.internalEdges.map((x) => x.id)).toEqual(["a_out__b_user"]);
    expect(result.boundaryIncoming.map((x) => x.id)).toEqual([
      "ext_out__b_system",
    ]);
    expect(result.boundaryOutgoing.map((x) => x.id)).toEqual([
      "b_out__out_out",
    ]);
  });

  it("topological order respects internal edge direction", () => {
    // c ← a → b → d; selection = a, b, c, d. Expected: a first
    // (no internal incoming), then b and c (both fed by a), then d.
    const nodes = [n("a", "text"), n("b", "text"), n("c", "text"), n("d", "text")];
    const edges = [
      e("a", "out", "b", "user"),
      e("a", "out", "c", "user"),
      e("b", "out", "d", "user"),
    ];
    const result = sliceSelectionSubgraph(nodes, edges, ["a", "b", "c", "d"]);
    const order = result.topologicalOrder;
    expect(order[0]).toBe("a");
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order).toHaveLength(4);
  });

  it("topological order falls back to insertion order on cycle", () => {
    // a → b → a — engine forbids this at run-time but the slicer
    // must not throw on a malformed slice. Both ids should still appear.
    const nodes = [n("a", "text"), n("b", "text")];
    const edges = [e("a", "out", "b", "user"), e("b", "out", "a", "user")];
    const result = sliceSelectionSubgraph(nodes, edges, ["a", "b"]);
    expect(result.topologicalOrder).toHaveLength(2);
    expect(new Set(result.topologicalOrder)).toEqual(new Set(["a", "b"]));
  });

  it("kindCounts groups by kind", () => {
    const nodes = [
      n("a", "text"),
      n("b", "text"),
      n("c", "text"),
      n("d", "llm-text"),
      n("e", "fal-image"),
    ];
    const result = sliceSelectionSubgraph(nodes, [], ["a", "b", "c", "d", "e"]);
    expect(result.kindCounts).toEqual({
      text: 3,
      "llm-text": 1,
      "fal-image": 1,
    });
  });

  it("exposes I/O via the existing autoDetectExposedIO contract", () => {
    // Two-node chain a → b. When both selected, `a.out` is consumed
    // internally; only `b.out` should be exposed (it's a leaf).
    const nodes = [n("a", "text", { text: "hello" }), n("b", "text", { text: "world" })];
    const edges = [e("a", "out", "b", "user")];
    const result = sliceSelectionSubgraph(nodes, edges, ["a", "b"]);
    // Text has no inputs (the body uses contenteditable, not a socket),
    // so no exposed inputs in either case.
    expect(result.exposedInputs).toHaveLength(0);
    // Only the leaf `b.out` is exposed.
    expect(result.exposedOutputs.map((h) => h.internalNodeId)).toEqual(["b"]);
  });

  it("ignores edges whose endpoints aren't both classified", () => {
    // Edge between two nodes neither of which is in the canvas should
    // not appear in any bucket. Defensive against stale data.
    const nodes = [n("a", "text"), n("b", "text")];
    const edges = [e("ghost", "out", "phantom", "user")];
    const result = sliceSelectionSubgraph(nodes, edges, ["a", "b"]);
    expect(result.internalEdges).toEqual([]);
    expect(result.boundaryIncoming).toEqual([]);
    expect(result.boundaryOutgoing).toEqual([]);
  });

  it("preserves node order from the input array (stable across calls)", () => {
    const nodes = [n("z", "text"), n("a", "text"), n("m", "text")];
    const result = sliceSelectionSubgraph(nodes, [], ["z", "a", "m"]);
    expect(result.nodes.map((x) => x.id)).toEqual(["z", "a", "m"]);
  });
});
