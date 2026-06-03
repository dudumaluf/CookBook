import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

/**
 * 2026-06-03 — Tier 1.3 recipe lifecycle tools.
 *
 * Four tools wrap recipe-row mutations:
 *   - delete_recipe
 *   - fork_recipe
 *   - list_recipe_versions
 *   - update_composite_to_latest (single + batch paths)
 *
 * Repository is mocked at the module boundary so we never hit
 * Supabase. `forkRecipe` is the real helper (exercises the chain
 * source → repo.save → returned record).
 */

const repoListMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const repoGetMock = vi.hoisted(() => vi.fn());
const repoSaveMock = vi.hoisted(() => vi.fn());
const repoRemoveMock = vi.hoisted(() => vi.fn());
const repoListVersionsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({
    list: repoListMock,
    get: repoGetMock,
    save: repoSaveMock,
    remove: repoRemoveMock,
    listVersions: repoListVersionsMock,
    getVersion: vi.fn(),
    saveAsNewVersion: vi.fn(),
  }),
  SupabaseRecipeRepository: class {},
}));

const { getTool } = await import("@/lib/assistant/tools");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  repoGetMock.mockReset();
  repoSaveMock.mockReset();
  repoRemoveMock.mockReset();
  repoListVersionsMock.mockReset().mockResolvedValue([]);
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* delete_recipe                                                      */
/* ────────────────────────────────────────────────────────────────── */

describe("delete_recipe tool", () => {
  it("deletes a recipe by id", async () => {
    repoRemoveMock.mockResolvedValue(undefined);
    const tool = getTool("delete_recipe")!;
    const out = (await tool.execute({ recipeId: "r1" }, {})) as {
      ok: boolean;
    };
    expect(out.ok).toBe(true);
    expect(repoRemoveMock).toHaveBeenCalledWith("r1");
  });

  it("surfaces repo errors as ok:false (not throws)", async () => {
    repoRemoveMock.mockRejectedValue(new Error("permission_denied"));
    const tool = getTool("delete_recipe")!;
    const out = (await tool.execute({ recipeId: "r1" }, {})) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("permission_denied");
  });

  it("rejects empty recipeId via Zod", async () => {
    const tool = getTool("delete_recipe")!;
    await expect(
      tool.execute({ recipeId: "" }, {}),
    ).rejects.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* fork_recipe                                                        */
/* ────────────────────────────────────────────────────────────────── */

describe("fork_recipe tool", () => {
  it("forks an existing recipe with default ' (copy)' suffix", async () => {
    repoGetMock.mockResolvedValue({
      id: "r1",
      ownerId: null,
      name: "Storyboard Director",
      description: "narrative",
      category: "describe",
      subgraph: { version: 1, nodes: [], edges: [] },
      isNode: true,
      parentRecipeId: null,
      createdAt: new Date().toISOString(),
      version: 3,
    });
    repoSaveMock.mockImplementation(async (input) => ({
      id: "r2",
      ownerId: input.ownerId,
      name: input.name,
      description: input.description,
      category: input.category,
      subgraph: input.subgraph,
      isNode: input.isNode,
      parentRecipeId: input.parentRecipeId,
      createdAt: new Date().toISOString(),
      version: 1,
    }));
    const tool = getTool("fork_recipe")!;
    const out = (await tool.execute(
      { sourceRecipeId: "r1" },
      { ownerId: "u1" },
    )) as {
      ok: boolean;
      recipeId: string;
      name: string;
      parentRecipeId: string;
    };
    expect(out.ok).toBe(true);
    expect(out.name).toBe("Storyboard Director (copy)");
    expect(out.parentRecipeId).toBe("r1");
    expect(repoSaveMock).toHaveBeenCalledTimes(1);
    const call = repoSaveMock.mock.calls[0]![0];
    expect(call.ownerId).toBe("u1");
  });

  it("respects custom nameSuffix", async () => {
    repoGetMock.mockResolvedValue({
      id: "r1",
      ownerId: null,
      name: "X",
      description: null,
      category: null,
      subgraph: { version: 1, nodes: [], edges: [] },
      isNode: true,
      parentRecipeId: null,
      createdAt: new Date().toISOString(),
      version: 1,
    });
    repoSaveMock.mockImplementation(async (input) => ({
      id: "r2",
      ownerId: input.ownerId,
      name: input.name,
      description: input.description,
      category: input.category,
      subgraph: input.subgraph,
      isNode: input.isNode,
      parentRecipeId: input.parentRecipeId,
      createdAt: new Date().toISOString(),
      version: 1,
    }));
    const tool = getTool("fork_recipe")!;
    const out = (await tool.execute(
      { sourceRecipeId: "r1", nameSuffix: " (variant)" },
      { ownerId: "u1" },
    )) as { ok: boolean; name: string };
    expect(out.name).toBe("X (variant)");
  });

  it("rejects without ownerId (security gate)", async () => {
    const tool = getTool("fork_recipe")!;
    const out = (await tool.execute(
      { sourceRecipeId: "r1" },
      {},
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("authenticated");
  });

  it("rejects when source recipe doesn't exist", async () => {
    repoGetMock.mockResolvedValue(null);
    const tool = getTool("fork_recipe")!;
    const out = (await tool.execute(
      { sourceRecipeId: "ghost" },
      { ownerId: "u1" },
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* list_recipe_versions                                               */
/* ────────────────────────────────────────────────────────────────── */

describe("list_recipe_versions tool", () => {
  it("returns current + archived versions, current first", async () => {
    repoGetMock.mockResolvedValue({
      id: "r1",
      ownerId: "u1",
      name: "X",
      description: "current",
      category: null,
      subgraph: { version: 1, nodes: [{}, {}, {}], edges: [{}] },
      isNode: true,
      parentRecipeId: null,
      createdAt: "2026-06-01T00:00:00Z",
      version: 3,
    });
    repoListVersionsMock.mockResolvedValue([
      {
        id: "v3-arch",
        recipeId: "r1",
        version: 2,
        subgraph: { version: 1, nodes: [{}, {}], edges: [] },
        name: "X",
        description: "v2",
        category: null,
        savedBy: "u1",
        createdAt: "2026-05-30T00:00:00Z",
      },
      {
        id: "v1-arch",
        recipeId: "r1",
        version: 1,
        subgraph: { version: 1, nodes: [{}], edges: [] },
        name: "X",
        description: "v1",
        category: null,
        savedBy: "u1",
        createdAt: "2026-05-29T00:00:00Z",
      },
    ]);
    const tool = getTool("list_recipe_versions")!;
    const out = (await tool.execute(
      { recipeId: "r1" },
      {},
    )) as {
      ok: boolean;
      versionCount: number;
      currentVersion: number;
      versions: Array<{
        version: number;
        isCurrent: boolean;
        nodeCount: number;
      }>;
    };
    expect(out.ok).toBe(true);
    expect(out.currentVersion).toBe(3);
    expect(out.versionCount).toBe(3);
    expect(out.versions[0]!.isCurrent).toBe(true);
    expect(out.versions[0]!.version).toBe(3);
    expect(out.versions[0]!.nodeCount).toBe(3);
    expect(out.versions[1]!.isCurrent).toBe(false);
    expect(out.versions[2]!.version).toBe(1);
  });

  it("strips subgraph by default but includes it when asked", async () => {
    repoGetMock.mockResolvedValue({
      id: "r1",
      ownerId: "u1",
      name: "X",
      description: null,
      category: null,
      subgraph: { version: 1, nodes: [{ id: "n1" }], edges: [] },
      isNode: true,
      parentRecipeId: null,
      createdAt: "2026-06-01T00:00:00Z",
      version: 1,
    });
    repoListVersionsMock.mockResolvedValue([]);
    const tool = getTool("list_recipe_versions")!;
    const without = (await tool.execute({ recipeId: "r1" }, {})) as {
      versions: Array<Record<string, unknown>>;
    };
    expect(without.versions[0]!).not.toHaveProperty("subgraph");
    const withSub = (await tool.execute(
      { recipeId: "r1", includeSubgraph: true },
      {},
    )) as { versions: Array<Record<string, unknown>> };
    expect(withSub.versions[0]!).toHaveProperty("subgraph");
  });

  it("rejects when recipe doesn't exist", async () => {
    repoGetMock.mockResolvedValue(null);
    const tool = getTool("list_recipe_versions")!;
    const out = (await tool.execute(
      { recipeId: "ghost" },
      {},
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* update_composite_to_latest                                         */
/* ────────────────────────────────────────────────────────────────── */

describe("update_composite_to_latest tool", () => {
  it("rejects when neither nodeId nor recipeId provided", async () => {
    const tool = getTool("update_composite_to_latest")!;
    await expect(tool.execute({}, {})).rejects.toThrow();
  });

  it("rejects when both nodeId and recipeId provided (XOR)", async () => {
    const tool = getTool("update_composite_to_latest")!;
    await expect(
      tool.execute({ nodeId: "n", recipeId: "r" }, {}),
    ).rejects.toThrow();
  });

  it("rejects when target node isn't a composite", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("update_composite_to_latest")!;
    const out = (await tool.execute(
      { nodeId: id },
      {},
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("text");
  });

  it("rejects when composite has no recipeId (saved without cloud row)", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("composite", { x: 0, y: 0 }, {
        recipeId: null,
        recipeName: "X",
        recipeVersion: null,
        subgraph: { version: 1, nodes: [], edges: [] },
        exposedInputs: [],
        exposedOutputs: [],
      });
    const tool = getTool("update_composite_to_latest")!;
    const out = (await tool.execute(
      { nodeId: id },
      {},
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("cloud");
  });

  it("updates a single composite to the latest recipe version", async () => {
    repoGetMock.mockResolvedValue({
      id: "r1",
      ownerId: null,
      name: "Updated name",
      description: null,
      category: null,
      subgraph: {
        version: 1,
        nodes: [
          {
            id: "inner-1",
            kind: "text",
            position: { x: 0, y: 0 },
            config: { text: "new" },
          },
        ],
        edges: [],
      },
      isNode: true,
      parentRecipeId: null,
      createdAt: new Date().toISOString(),
      version: 5,
    });
    const id = useWorkflowStore
      .getState()
      .addNode("composite", { x: 0, y: 0 }, {
        recipeId: "r1",
        recipeName: "Old",
        recipeVersion: 3,
        subgraph: { version: 1, nodes: [], edges: [] },
        exposedInputs: [],
        exposedOutputs: [],
        exposedParams: [],
      });
    const tool = getTool("update_composite_to_latest")!;
    const out = (await tool.execute(
      { nodeId: id },
      {},
    )) as {
      ok: boolean;
      updatedCount: number;
      preservedOverrides: number;
      droppedOverrides: number;
    };
    expect(out.ok).toBe(true);
    expect(out.updatedCount).toBe(1);
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    const cfg = node.config as { recipeVersion: number; recipeName: string };
    expect(cfg.recipeVersion).toBe(5);
    expect(cfg.recipeName).toBe("Updated name");
  });

  it("batch-updates all composites of a recipe", async () => {
    repoGetMock.mockResolvedValue({
      id: "r1",
      ownerId: null,
      name: "X",
      description: null,
      category: null,
      subgraph: {
        version: 1,
        nodes: [
          {
            id: "i1",
            kind: "text",
            position: { x: 0, y: 0 },
            config: { text: "x" },
          },
        ],
        edges: [],
      },
      isNode: true,
      parentRecipeId: null,
      createdAt: new Date().toISOString(),
      version: 7,
    });
    useWorkflowStore.getState().addNode("composite", { x: 0, y: 0 }, {
      recipeId: "r1",
      recipeName: "X",
      recipeVersion: 5,
      subgraph: { version: 1, nodes: [], edges: [] },
      exposedInputs: [],
      exposedOutputs: [],
      exposedParams: [],
    });
    useWorkflowStore.getState().addNode("composite", { x: 100, y: 0 }, {
      recipeId: "r1",
      recipeName: "X",
      recipeVersion: 6,
      subgraph: { version: 1, nodes: [], edges: [] },
      exposedInputs: [],
      exposedOutputs: [],
      exposedParams: [],
    });
    // One unrelated composite that should NOT be updated.
    useWorkflowStore.getState().addNode("composite", { x: 200, y: 0 }, {
      recipeId: "r2",
      recipeName: "Y",
      recipeVersion: 1,
      subgraph: { version: 1, nodes: [], edges: [] },
      exposedInputs: [],
      exposedOutputs: [],
      exposedParams: [],
    });
    const tool = getTool("update_composite_to_latest")!;
    const out = (await tool.execute(
      { recipeId: "r1" },
      {},
    )) as {
      ok: boolean;
      totalInstances: number;
      updatedCount: number;
    };
    expect(out.ok).toBe(true);
    expect(out.totalInstances).toBe(2);
    expect(out.updatedCount).toBe(2);
    // Unrelated composite untouched.
    const r2Node = useWorkflowStore
      .getState()
      .nodes.find(
        (n) => (n.config as { recipeId?: string }).recipeId === "r2",
      );
    expect(
      (r2Node!.config as { recipeVersion: number }).recipeVersion,
    ).toBe(1);
  });
});
