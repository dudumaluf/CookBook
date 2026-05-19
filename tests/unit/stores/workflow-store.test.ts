import { beforeEach, describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

beforeEach(() => {
  useWorkflowStore.getState().clear();
  localStorage.clear();
});

describe("workflow-store", () => {
  it("addNode creates a node with default config from the registry", () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 10, y: 20 });
    const node = useWorkflowStore.getState().nodes[0];
    expect(id).toMatch(/^text_/);
    expect(node?.kind).toBe("text");
    expect(node?.position).toEqual({ x: 10, y: 20 });
    expect(node?.config).toEqual({ text: "" });
  });

  it("addNode returns empty string for unknown kinds", () => {
    const id = useWorkflowStore.getState().addNode("does-not-exist", {
      x: 0,
      y: 0,
    });
    expect(id).toBe("");
    expect(useWorkflowStore.getState().nodes).toHaveLength(0);
  });

  it("addNode merges initialConfig over the schema's defaultConfig", () => {
    const id = useWorkflowStore.getState().addNode(
      "image",
      { x: 0, y: 0 },
      { url: "https://example.com/cat.jpg", assetId: "asset_abc" },
    );
    expect(useWorkflowStore.getState().nodes[0]?.config).toEqual({
      url: "https://example.com/cat.jpg",
      assetId: "asset_abc",
    });
    expect(id).toMatch(/^image_/);
  });

  it("updateNodeConfig merges partial config", () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    useWorkflowStore
      .getState()
      .updateNodeConfig<{ text: string }>(id, { text: "hello" });
    expect(useWorkflowStore.getState().nodes[0]?.config).toEqual({
      text: "hello",
    });
  });

  it("moveNode updates position only", () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    useWorkflowStore.getState().moveNode(id, { x: 100, y: 50 });
    expect(useWorkflowStore.getState().nodes[0]?.position).toEqual({
      x: 100,
      y: 50,
    });
  });

  it("removeNode also removes connected edges", () => {
    const a = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addNode("image", { x: 0, y: 0 });
    useWorkflowStore.getState().addEdge({
      source: a,
      sourceHandle: "out",
      target: b,
      targetHandle: "in",
    });
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
    useWorkflowStore.getState().removeNode(a);
    expect(useWorkflowStore.getState().edges).toHaveLength(0);
  });

  it("addEdge rejects self-loops", () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const eid = useWorkflowStore.getState().addEdge({
      source: id,
      sourceHandle: "out",
      target: id,
      targetHandle: "in",
    });
    expect(eid).toBeUndefined();
  });

  it("addEdge rejects a second connection into the same single-input handle", () => {
    const a = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const b = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const c = useWorkflowStore.getState().addNode("image", { x: 0, y: 0 });
    // Image has no inputs, so let's use Text→Text via the (nonexistent) input
    // — registry-driven check should still reject the duplicate.
    const first = useWorkflowStore.getState().addEdge({
      source: a,
      sourceHandle: "out",
      target: c,
      targetHandle: "in",
    });
    expect(first).toBeDefined();
    const second = useWorkflowStore.getState().addEdge({
      source: b,
      sourceHandle: "out",
      target: c,
      targetHandle: "in",
    });
    expect(second).toBeUndefined();
  });
});
