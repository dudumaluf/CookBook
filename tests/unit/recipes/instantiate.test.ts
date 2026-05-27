import { beforeEach, describe, expect, it } from "vitest";

import { instantiateRecipeOnCanvas } from "@/lib/recipes/instantiate";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { RecipeSubgraph } from "@/lib/repositories/recipe-repository";

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

describe("instantiateRecipeOnCanvas", () => {
  it("spawns fresh nodes with new ids and remapped positions", () => {
    const subgraph: RecipeSubgraph = {
      version: 1,
      nodes: [
        {
          id: "saved-a",
          kind: "text",
          position: { x: 100, y: 100 },
          config: { text: "hi" },
        },
        {
          id: "saved-b",
          kind: "text",
          position: { x: 300, y: 200 },
          config: { text: "bye" },
        },
      ],
      edges: [],
    };
    const result = instantiateRecipeOnCanvas({
      subgraph,
      position: { x: 500, y: 500 },
    });
    expect(result.nodeIds).toHaveLength(2);
    // New ids — different from saved ids.
    expect(result.nodeIds.every((id) => id !== "saved-a" && id !== "saved-b")).toBe(true);
    const nodes = useWorkflowStore.getState().nodes;
    expect(nodes).toHaveLength(2);
    // Positions translated so the saved top-left lands at (500, 500).
    // (Saved min was 100, 100; so dx=400, dy=400.)
    expect(nodes[0]!.position).toEqual({ x: 500, y: 500 });
    expect(nodes[1]!.position).toEqual({ x: 700, y: 600 });
  });

  it("remaps edges to new node ids", () => {
    const subgraph: RecipeSubgraph = {
      version: 1,
      nodes: [
        {
          id: "n1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "" },
        },
        {
          id: "n2",
          kind: "text",
          position: { x: 200, y: 0 },
          config: { text: "" },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "n1",
          sourceHandle: "out",
          target: "n2",
          targetHandle: "in",
        },
      ],
    };
    const result = instantiateRecipeOnCanvas({
      subgraph,
      position: { x: 0, y: 0 },
    });
    const edges = useWorkflowStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]!.source).toBe(result.nodeIds[0]!);
    expect(edges[0]!.target).toBe(result.nodeIds[1]!);
    // Handles preserved.
    expect(edges[0]!.sourceHandle).toBe("out");
    expect(edges[0]!.targetHandle).toBe("in");
  });

  it("preserves existing canvas nodes (additive, not overwrite)", () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "existing-1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "kept" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    instantiateRecipeOnCanvas({
      subgraph: {
        version: 1,
        nodes: [
          {
            id: "saved-a",
            kind: "text",
            position: { x: 0, y: 0 },
            config: { text: "spawned" },
          },
        ],
        edges: [],
      },
      position: { x: 100, y: 100 },
    });
    const nodes = useWorkflowStore.getState().nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.id).toBe("existing-1");
  });

  it("drops edges referencing missing nodes (defensive)", () => {
    instantiateRecipeOnCanvas({
      subgraph: {
        version: 1,
        nodes: [
          {
            id: "n1",
            kind: "text",
            position: { x: 0, y: 0 },
            config: { text: "" },
          },
        ],
        edges: [
          {
            id: "dangling",
            source: "n1",
            sourceHandle: "out",
            target: "missing",
            targetHandle: "in",
          },
        ],
      },
      position: { x: 0, y: 0 },
    });
    expect(useWorkflowStore.getState().edges).toHaveLength(0);
  });
});
