import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

import type { CompositeNodeConfig } from "@/components/nodes/node-composite";
import type { RecipeRecord } from "@/lib/repositories/recipe-repository";

const getMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({ get: getMock }),
}));

const {
  applyExposedOverrides,
  captureExposedOverrides,
  countCompositesByRecipe,
  findStaleInstances,
  updateAllCompositesByRecipe,
  updateCompositeInstance,
} = await import("@/lib/recipes/update-composite");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

function compositeConfig(
  overrides: Partial<CompositeNodeConfig> = {},
): Record<string, unknown> {
  // Cast to Record<string, unknown> at the helper boundary so each call
  // site can pass it directly to `addNode(initialConfig)` without an
  // individual cast. The shape is a real `CompositeNodeConfig`; the
  // wider type only loosens TS's index-signature check.
  const cfg: CompositeNodeConfig = {
    recipeId: "r-source",
    recipeName: "Test",
    recipeVersion: 1,
    subgraph: {
      version: 2,
      nodes: [
        {
          id: "inner-1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "old text" },
        },
      ],
      edges: [],
    },
    exposedInputs: [],
    exposedOutputs: [],
    exposedParams: [
      {
        label: "Briefing",
        internalNodeId: "inner-1",
        configKey: "text",
        control: "text",
      },
    ],
    ...overrides,
  };
  return cfg as unknown as Record<string, unknown>;
}

function recipeRecord(overrides: Partial<RecipeRecord> = {}): RecipeRecord {
  return {
    id: "r-source",
    ownerId: null,
    name: "Test recipe",
    description: null,
    category: null,
    subgraph: {
      version: 2,
      nodes: [
        {
          id: "inner-1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "DEFAULT" },
        },
      ],
      edges: [],
      exposedInputs: [],
      exposedOutputs: [],
      exposedParams: [
        {
          label: "Briefing",
          internalNodeId: "inner-1",
          configKey: "text",
          control: "text",
        },
      ],
    },
    isNode: true,
    parentRecipeId: null,
    createdAt: "2026-06-01T00:00:00Z",
    version: 2,
    ...overrides,
  };
}

beforeEach(() => {
  useWorkflowStore.getState().clear();
});

afterEach(() => {
  getMock.mockReset();
});

describe("captureExposedOverrides + applyExposedOverrides", () => {
  it("captures the user-edited values from inner nodes via exposedParams", () => {
    const cfg = compositeConfig() as unknown as CompositeNodeConfig;
    const captured = captureExposedOverrides(cfg);
    expect(captured.size).toBe(1);
    expect(captured.get("inner-1")).toEqual({ text: "old text" });
  });

  it("re-applies overrides on a fresh subgraph when the inner id still exists", () => {
    const captured = new Map([["inner-1", { text: "USER VALUE" }]]);
    const newSubgraph = {
      version: 2 as const,
      nodes: [
        {
          id: "inner-1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "DEFAULT" },
        },
      ],
      edges: [],
    };
    const result = applyExposedOverrides(newSubgraph, captured);
    expect(result.preserved).toBe(1);
    expect(result.dropped).toBe(0);
    const inner = result.subgraph.nodes[0]!.config as { text: string };
    expect(inner.text).toBe("USER VALUE");
  });

  it("drops overrides whose inner node id no longer exists in the new subgraph", () => {
    const captured = new Map([
      ["inner-gone", { text: "lost" }],
      ["inner-1", { text: "kept" }],
    ]);
    const newSubgraph = {
      version: 2 as const,
      nodes: [
        {
          id: "inner-1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [],
    };
    const result = applyExposedOverrides(newSubgraph, captured);
    expect(result.preserved).toBe(1);
    expect(result.dropped).toBe(1);
  });
});

describe("findStaleInstances + countCompositesByRecipe", () => {
  it("findStaleInstances returns only composites pinned to that recipe with version < target", () => {
    useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: "r-source", recipeVersion: 1 }),
    );
    useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: "r-source", recipeVersion: 2 }),
    );
    useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: "r-other", recipeVersion: 1 }),
    );
    const stale = findStaleInstances("r-source", 2);
    expect(stale).toHaveLength(1);
  });

  it("countCompositesByRecipe counts both stale and up-to-date instances", () => {
    useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: "r-source", recipeVersion: 1 }),
    );
    useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: "r-source", recipeVersion: 2 }),
    );
    useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: "r-other", recipeVersion: 1 }),
    );
    expect(countCompositesByRecipe("r-source")).toBe(2);
    expect(countCompositesByRecipe("r-other")).toBe(1);
  });

  it("ignores pre-B1 composites with null recipeVersion", () => {
    useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: "r-source", recipeVersion: null }),
    );
    expect(findStaleInstances("r-source", 999)).toHaveLength(0);
  });
});

describe("updateCompositeInstance", () => {
  it("replaces subgraph + bumps recipeVersion + preserves user overrides", async () => {
    const id = useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({
        recipeVersion: 1,
        subgraph: {
          version: 2 as const,
          nodes: [
            {
              id: "inner-1",
              kind: "text",
              position: { x: 0, y: 0 },
              config: { text: "MY OVERRIDE" },
            },
          ],
          edges: [],
        },
      }),
    );
    getMock.mockResolvedValue(recipeRecord({ version: 5 }));
    const result = await updateCompositeInstance({ nodeId: id });
    expect(result.ok).toBe(true);
    expect(result.preservedOverrides).toBe(1);
    const updated = useWorkflowStore.getState().nodes[0]!.config as CompositeNodeConfig;
    expect(updated.recipeVersion).toBe(5);
    const inner = updated.subgraph.nodes[0]!.config as { text: string };
    expect(inner.text).toBe("MY OVERRIDE");
  });

  it("returns ok=false when the node has no recipe id", async () => {
    const id = useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: null }),
    );
    const result = await updateCompositeInstance({ nodeId: id });
    expect(result.ok).toBe(false);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("returns ok=false when the recipe has been deleted from the cloud", async () => {
    const id = useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig(),
    );
    getMock.mockResolvedValue(null);
    const result = await updateCompositeInstance({ nodeId: id });
    expect(result.ok).toBe(false);
  });
});

describe("updateAllCompositesByRecipe", () => {
  it("updates every stale instance pinned to the recipe in one pass", async () => {
    useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: "r-source", recipeVersion: 1 }),
    );
    useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: "r-source", recipeVersion: 1 }),
    );
    useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: "r-other", recipeVersion: 1 }),
    );
    getMock.mockResolvedValue(recipeRecord({ version: 3 }));
    const result = await updateAllCompositesByRecipe({ recipeId: "r-source" });
    expect(result.ok).toBe(true);
    expect(result.updatedCount).toBe(2);
    const versions = useWorkflowStore
      .getState()
      .nodes.map((n) => (n.config as CompositeNodeConfig).recipeVersion);
    expect(versions.filter((v) => v === 3)).toHaveLength(2);
    // The unrelated composite (r-other) stays at v1.
    expect(versions.filter((v) => v === 1)).toHaveLength(1);
  });

  it("is a noop when there are no stale instances", async () => {
    useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      compositeConfig({ recipeId: "r-source", recipeVersion: 5 }),
    );
    getMock.mockResolvedValue(recipeRecord({ version: 3 }));
    const result = await updateAllCompositesByRecipe({ recipeId: "r-source" });
    expect(result.ok).toBe(true);
    expect(result.updatedCount).toBe(0);
  });
});
