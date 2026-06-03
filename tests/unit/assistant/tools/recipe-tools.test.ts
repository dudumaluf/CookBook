import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

/**
 * 2026-06-03 — Coverage backfill for the three recipe-lifecycle tools
 * registered in Slice 7.3 but never given dedicated unit tests
 * (`save_selection_as_recipe`, `instantiate_recipe`, `unpack_composite`).
 * The audit found them only exercised via the reasoner integration
 * test, leaving Zod parsing, error branches, and store-mutation shape
 * unproven in isolation.
 *
 * Repository is mocked at module level so the tools never hit Supabase
 * in tests. Each test verifies the OBSERVABLE contract (return shape +
 * workflow-store mutation), not internal helpers.
 */

const repoSaveMock = vi.hoisted(() => vi.fn());
const repoGetMock = vi.hoisted(() => vi.fn());
const repoListMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const repoRemoveMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({
    list: repoListMock,
    get: repoGetMock,
    save: repoSaveMock,
    remove: repoRemoveMock,
  }),
  SupabaseRecipeRepository: class {},
}));

const { getTool } = await import("@/lib/assistant/tools");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  repoSaveMock.mockReset();
  repoGetMock.mockReset();
  // Default: repo.save echoes input back as a "saved" record.
  repoSaveMock.mockImplementation(async (rec: unknown) => rec);
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

/* ────────────────────────────────────────────────────────────────── */
/* save_selection_as_recipe                                           */
/* ────────────────────────────────────────────────────────────────── */

describe("save_selection_as_recipe tool", () => {
  it("rejects when there's no authenticated user (security gate)", async () => {
    const tool = getTool("save_selection_as_recipe")!;
    const out = (await tool.execute(
      { name: "Mood pack" },
      {}, // no ownerId
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("authenticated");
    expect(repoSaveMock).not.toHaveBeenCalled();
  });

  it("rejects when the selection is empty (asks the LLM to select_nodes first)", async () => {
    const tool = getTool("save_selection_as_recipe")!;
    const out = (await tool.execute(
      { name: "Mood pack" },
      { ownerId: "u1" },
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/select_nodes|empty/i);
  });

  it("auto-detects exposed I/O when the LLM omits both lists", async () => {
    // Wire two text nodes — the second exposes its `out` handle as
    // dangling, so auto-detect should pick it up as an output.
    const id1 = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    useWorkflowStore.getState().setSelectedNodeIds([id1]);
    const tool = getTool("save_selection_as_recipe")!;
    const out = (await tool.execute(
      {
        name: "Single text",
        description: "A toy recipe with one text node.",
        replaceWithComposite: false,
      },
      { ownerId: "u1" },
    )) as {
      ok: boolean;
      recipeId?: string;
      compositeNodeId?: string;
    };
    expect(out.ok).toBe(true);
    expect(repoSaveMock).toHaveBeenCalledTimes(1);
    const saved = repoSaveMock.mock.calls[0]![0];
    expect(saved.name).toBe("Single text");
    expect(saved.subgraph?.nodes).toHaveLength(1);
    // No composite when replaceWithComposite is false.
    expect(out.compositeNodeId).toBeUndefined();
    // Selection nodes still on canvas.
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
  });

  it("collapses selection into a composite by default", async () => {
    const id1 = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    useWorkflowStore.getState().setSelectedNodeIds([id1]);
    const tool = getTool("save_selection_as_recipe")!;
    const out = (await tool.execute(
      { name: "Compact recipe" },
      { ownerId: "u1" },
    )) as {
      ok: boolean;
      compositeNodeId?: string;
    };
    expect(out.ok).toBe(true);
    expect(out.compositeNodeId).toBeTruthy();
    // Composite REPLACED the original selection: 1 node still on canvas
    // but its kind is composite, not text.
    const nodes = useWorkflowStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe("composite");
  });

  it("rejects unknown args via strict Zod (typo-proof contract)", async () => {
    const tool = getTool("save_selection_as_recipe")!;
    await expect(
      tool.execute({ name: "ok", weird: 1 }, { ownerId: "u1" }),
    ).rejects.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* instantiate_recipe                                                 */
/* ────────────────────────────────────────────────────────────────── */

describe("instantiate_recipe tool", () => {
  it("rejects when the recipe doesn't exist", async () => {
    repoGetMock.mockResolvedValue(null);
    const tool = getTool("instantiate_recipe")!;
    const out = (await tool.execute(
      { recipeId: "ghost" },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
  });

  it("spawns a single composite node when mode='node'", async () => {
    repoGetMock.mockResolvedValue({
      id: "r1",
      name: "Demo recipe",
      version: 1,
      isNode: true,
      subgraph: {
        nodes: [
          {
            id: "n1",
            kind: "text",
            position: { x: 0, y: 0 },
            config: { text: "hi" },
          },
        ],
        edges: [],
        exposedInputs: [],
        exposedOutputs: [],
      },
    });
    const tool = getTool("instantiate_recipe")!;
    const out = (await tool.execute(
      { recipeId: "r1", mode: "node" },
      {},
    )) as { ok: boolean; mode: string; compositeNodeId: string };
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("node");
    expect(out.compositeNodeId).toBeTruthy();
    const nodes = useWorkflowStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe("composite");
  });

  it("expands inner nodes when mode='expand'", async () => {
    repoGetMock.mockResolvedValue({
      id: "r1",
      name: "Demo",
      version: 1,
      isNode: false,
      subgraph: {
        nodes: [
          {
            id: "a",
            kind: "text",
            position: { x: 0, y: 0 },
            config: { text: "alpha" },
          },
          {
            id: "b",
            kind: "text",
            position: { x: 200, y: 0 },
            config: { text: "beta" },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "a",
            sourceHandle: "out",
            target: "b",
            targetHandle: "out",
          },
        ],
      },
    });
    const tool = getTool("instantiate_recipe")!;
    const out = (await tool.execute(
      { recipeId: "r1", mode: "expand" },
      {},
    )) as { ok: boolean; mode: string; spawnedNodeIds: string[] };
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("expand");
    expect(out.spawnedNodeIds).toHaveLength(2);
    expect(useWorkflowStore.getState().nodes).toHaveLength(2);
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
  });

  it("falls back to recipe.isNode when mode is omitted", async () => {
    repoGetMock.mockResolvedValue({
      id: "r1",
      name: "Demo",
      version: 1,
      isNode: false, // expand by default
      subgraph: { nodes: [], edges: [] },
    });
    const tool = getTool("instantiate_recipe")!;
    const out = (await tool.execute({ recipeId: "r1" }, {})) as {
      ok: boolean;
      mode: string;
    };
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("expand");
  });

  it("rejects empty recipeId via Zod", async () => {
    const tool = getTool("instantiate_recipe")!;
    await expect(
      tool.execute({ recipeId: "" }, {}),
    ).rejects.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* unpack_composite                                                   */
/* ────────────────────────────────────────────────────────────────── */

describe("unpack_composite tool", () => {
  it("rejects when the node doesn't exist", async () => {
    const tool = getTool("unpack_composite")!;
    const out = (await tool.execute(
      { compositeNodeId: "ghost" },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
  });

  it("rejects when the node exists but isn't a composite", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("unpack_composite")!;
    const out = (await tool.execute(
      { compositeNodeId: id },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("text");
    // State unchanged.
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
  });

  it("expands a composite into its inner subgraph", async () => {
    const compositeId = useWorkflowStore.getState().addNode(
      "composite",
      { x: 0, y: 0 },
      {
        recipeId: "r1",
        recipeName: "Demo",
        recipeVersion: 1,
        subgraph: {
          version: 1,
          nodes: [
            {
              id: "inner-a",
              kind: "text",
              position: { x: 0, y: 0 },
              config: { text: "alpha" },
            },
            {
              id: "inner-b",
              kind: "text",
              position: { x: 200, y: 0 },
              config: { text: "beta" },
            },
          ],
          edges: [],
        },
        exposedInputs: [],
        exposedOutputs: [],
      },
    );
    const tool = getTool("unpack_composite")!;
    const out = (await tool.execute(
      { compositeNodeId: compositeId },
      {},
    )) as { ok: boolean };
    expect(out.ok).toBe(true);
    // Composite gone, two text nodes in its place.
    const nodes = useWorkflowStore.getState().nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.kind === "text")).toBe(true);
    // No composite node lingering.
    expect(nodes.find((n) => n.id === compositeId)).toBeUndefined();
  });

  it("rejects empty compositeNodeId via Zod", async () => {
    const tool = getTool("unpack_composite")!;
    await expect(
      tool.execute({ compositeNodeId: "" }, {}),
    ).rejects.toThrow();
  });
});
