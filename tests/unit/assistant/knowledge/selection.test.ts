import { beforeEach, describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";

const { buildSelectionKnowledge } = await import(
  "@/lib/assistant/knowledge/selection"
);
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

/**
 * Selection knowledge dimension — auto-attached to the assistant's
 * system prompt when the user has multi-node selection on the canvas.
 *
 * Skip rules:
 *   - 0 nodes selected → null
 *   - 1 node selected  → null (canvas summary already lists it)
 *   - 2+ nodes selected → focused subgraph block
 *
 * Truncation rules — when the slice exceeds the soft token budget,
 * configs are dropped first; topology + edges + I/O remain.
 */

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

describe("buildSelectionKnowledge", () => {
  it("returns null when nothing is selected", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    expect(buildSelectionKnowledge()).toBeNull();
  });

  it("returns null when only one node is selected", () => {
    // Single-node selection is already covered by the canvas knowledge
    // block; emitting another section would just duplicate context.
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "b", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: ["a"],
      selectedEdgeIds: [],
    });
    expect(buildSelectionKnowledge()).toBeNull();
  });

  it("returns null when skip flag is set, regardless of selection size", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "b", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: ["a", "b"],
      selectedEdgeIds: [],
    });
    expect(buildSelectionKnowledge({ skip: true })).toBeNull();
  });

  it("emits a focused block for a 2+ node selection", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: { text: "hi" } },
        { id: "b", kind: "text", position: { x: 0, y: 0 }, config: { text: "world" } },
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "b", targetHandle: "user" },
      ],
      selectedNodeIds: ["a", "b"],
      selectedEdgeIds: [],
    });
    const md = buildSelectionKnowledge();
    expect(md).not.toBeNull();
    expect(md).toContain("## SELECTION (2 nodes, 1 internal edges, 0 boundary edges)");
    expect(md).toContain("Topology (in execution order):");
    expect(md).toContain("a [Text]");
    expect(md).toContain("b [Text]");
    expect(md).toContain("a.out → b.user");
    expect(md).toContain("Exposed I/O if saved as recipe:");
  });

  it("includes a Boundary section when the slice has external edges", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "ext", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "b", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "out", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        // external → a (incoming boundary)
        { id: "e1", source: "ext", sourceHandle: "out", target: "a", targetHandle: "user" },
        // internal
        { id: "e2", source: "a", sourceHandle: "out", target: "b", targetHandle: "user" },
        // b → external (outgoing boundary)
        { id: "e3", source: "b", sourceHandle: "out", target: "out", targetHandle: "user" },
      ],
      selectedNodeIds: ["a", "b"],
      selectedEdgeIds: [],
    });
    const md = buildSelectionKnowledge()!;
    expect(md).toContain("Boundary:");
    expect(md).toContain("in:  external ext.out → a.user");
    expect(md).toContain("out: b.out → external out.user");
  });

  it("redacts URLs in config values so the prompt stays compact + safe", () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "a",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "see https://api.example.com/very/long/path?key=secret123 now" },
        },
        { id: "b", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: ["a", "b"],
      selectedEdgeIds: [],
    });
    const md = buildSelectionKnowledge()!;
    expect(md).toContain("[url]");
    expect(md).not.toContain("api.example.com");
    expect(md).not.toContain("secret123");
  });

  it("truncates long string config values", () => {
    const longText = "x".repeat(500);
    useWorkflowStore.setState({
      nodes: [
        {
          id: "a",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: longText },
        },
        { id: "b", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: ["a", "b"],
      selectedEdgeIds: [],
    });
    const md = buildSelectionKnowledge()!;
    // Truncation marker for long string values.
    expect(md).toContain("...");
    // The full 500-char string should NOT appear.
    expect(md).not.toContain(longText);
  });

  it("falls back to compact summary when the selection is huge", () => {
    // 60 nodes with sizable config bodies — exceeds the soft budget,
    // forcing the compact fallback path.
    const nodes = Array.from({ length: 60 }, (_, i) => ({
      id: `n${i}`,
      kind: "text" as const,
      position: { x: 0, y: 0 },
      config: { text: "x".repeat(150) },
    }));
    useWorkflowStore.setState({
      nodes,
      edges: [],
      selectedNodeIds: nodes.map((n) => n.id),
      selectedEdgeIds: [],
    });
    const md = buildSelectionKnowledge()!;
    // Header still present (we never drop it).
    expect(md).toContain("## SELECTION (60 nodes");
    // Either the per-node configs are dropped, OR we hit the deepest
    // fallback that reports edge counts inline. Both contain a notice.
    expect(md.toLowerCase()).toMatch(/omitted to fit budget/);
  });

  it("counts kinds with descending frequency", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "b", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "c", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: ["a", "b", "c"],
      selectedEdgeIds: [],
    });
    const md = buildSelectionKnowledge()!;
    // text comes first (count 2), then llm-text (count 1).
    const textIdx = md.indexOf("text ×2");
    const llmIdx = md.indexOf("llm-text ×1");
    expect(textIdx).toBeGreaterThan(-1);
    expect(llmIdx).toBeGreaterThan(textIdx);
  });
});
