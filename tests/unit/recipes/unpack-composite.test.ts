import { beforeEach, describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";
import { unpackComposite } from "@/lib/recipes/unpack-composite";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * Slice 6.6 — unpack-composite inverts saveSelectionAsRecipe on canvas:
 * the composite node is removed and its captured subgraph is spawned
 * with fresh ids around the composite's old position. External edges
 * that landed on exposed handles get rewired to the matching internal
 * node + handle.
 */

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

describe("unpackComposite", () => {
  it("replaces the composite with its captured nodes (fresh ids, translated positions)", () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "comp-1",
          kind: "composite",
          position: { x: 500, y: 500 },
          config: {
            recipeId: null,
            recipeName: "Test recipe",
            subgraph: {
              version: 1,
              nodes: [
                {
                  id: "saved-text",
                  kind: "text",
                  position: { x: 100, y: 100 },
                  config: { text: "kept" },
                },
              ],
              edges: [],
              exposedInputs: [],
              exposedOutputs: [],
            },
            exposedInputs: [],
            exposedOutputs: [],
          },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });

    unpackComposite("comp-1");

    const ws = useWorkflowStore.getState();
    expect(ws.nodes).toHaveLength(1);
    expect(ws.nodes[0]!.kind).toBe("text");
    // The captured node's id was regenerated.
    expect(ws.nodes[0]!.id).not.toBe("saved-text");
    // Position translated so the unpacked top-left lands at the
    // composite's old position (500, 500).
    expect(ws.nodes[0]!.position).toEqual({ x: 500, y: 500 });
    // Composite is gone.
    expect(ws.nodes.find((n) => n.kind === "composite")).toBeUndefined();
  });

  it("rewires an external incoming edge from composite handle to the matching internal node handle", () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "upstream",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "value" },
        },
        {
          id: "comp-1",
          kind: "composite",
          position: { x: 200, y: 0 },
          config: {
            recipeId: null,
            recipeName: "Test recipe",
            subgraph: {
              version: 1,
              nodes: [
                {
                  id: "internal-llm",
                  kind: "llm-text",
                  position: { x: 0, y: 0 },
                  config: {},
                },
              ],
              edges: [],
              exposedInputs: [
                {
                  internalNodeId: "internal-llm",
                  internalHandleId: "user-0",
                  label: "user",
                  dataType: "text",
                },
              ],
              exposedOutputs: [],
            },
            exposedInputs: [
              {
                internalNodeId: "internal-llm",
                internalHandleId: "user-0",
                label: "user",
                dataType: "text",
              },
            ],
            exposedOutputs: [],
          },
        },
      ],
      edges: [
        {
          id: "u-to-comp",
          source: "upstream",
          sourceHandle: "out",
          target: "comp-1",
          // External edge targets the COMPOSITE's exposed handle, which is
          // keyed by the exposed input's `label` ("user") — not by the
          // internal node's handle id ("user-0"). After unpack, this edge
          // gets re-anchored onto the internal node + its internal handle
          // ("user-0").
          targetHandle: "user",
        },
      ],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });

    unpackComposite("comp-1");

    const ws = useWorkflowStore.getState();
    // The incoming edge's target switched from comp-1 -> the new llm node id.
    const llmNode = ws.nodes.find((n) => n.kind === "llm-text");
    expect(llmNode).toBeDefined();
    const rewired = ws.edges.find((e) => e.source === "upstream");
    expect(rewired).toBeDefined();
    expect(rewired!.target).toBe(llmNode!.id);
    expect(rewired!.targetHandle).toBe("user-0");
  });

  it("does nothing when the target node id isn't a composite", () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "regular",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    unpackComposite("regular");
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
  });
});
