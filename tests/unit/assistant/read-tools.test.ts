import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

const recipeRepoMocks = {
  list: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
};
vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => recipeRepoMocks,
  SupabaseRecipeRepository: class {},
}));

const generationRepoMocks = {
  list: vi.fn().mockResolvedValue([]),
  insert: vi.fn(),
  setPinned: vi.fn(),
  setTitle: vi.fn(),
  setTags: vi.fn(),
  remove: vi.fn(),
  listForNode: vi.fn().mockResolvedValue([]),
};
vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => generationRepoMocks,
  SupabaseGenerationRepository: class {},
}));

const { getTool, getToolDefinitions } = await import(
  "@/lib/assistant/tools"
);
const { useAssetStore } = await import("@/lib/stores/asset-store");
const { useExecutionStore } = await import("@/lib/stores/execution-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
  useAssetStore.setState({
    assets: [],
    selectedAssetIds: [],
    selectionAnchorId: null,
  });
  useExecutionStore.setState({
    runId: 0,
    isRunning: false,
    records: new Map(),
  });
  recipeRepoMocks.list.mockReset();
  recipeRepoMocks.get.mockReset();
  generationRepoMocks.list.mockReset();
  generationRepoMocks.list.mockResolvedValue([]);
});

describe("tool registry", () => {
  it("ships the 5 read tools (Slice 7.2)", () => {
    const defs = getToolDefinitions();
    const names = defs.map((d) => d.function.name);
    expect(names).toContain("read_canvas");
    expect(names).toContain("read_node_state");
    expect(names).toContain("read_library");
    expect(names).toContain("read_gallery");
    expect(names).toContain("read_recipe");
  });

  it("each tool definition carries description + JSON Schema parameters", () => {
    for (const d of getToolDefinitions()) {
      expect(d.function.description.length).toBeGreaterThan(20);
      expect(d.function.parameters).toHaveProperty("type", "object");
    }
  });
});

describe("read_canvas tool", () => {
  it("returns nodes + edges + selection from the workflow store", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          kind: "text",
          position: { x: 10, y: 20 },
          config: { text: "hi" },
        },
      ],
      edges: [],
      selectedNodeIds: ["n1"],
      selectedEdgeIds: [],
    });
    const tool = getTool("read_canvas")!;
    const out = (await tool.execute({}, {})) as {
      nodes: { id: string; status: string }[];
      edges: unknown[];
      selectedNodeIds: string[];
    };
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]?.id).toBe("n1");
    expect(out.nodes[0]?.status).toBe("idle");
    expect(out.selectedNodeIds).toEqual(["n1"]);
  });
});

describe("read_node_state tool", () => {
  it("returns found:false when node id missing", async () => {
    const tool = getTool("read_node_state")!;
    const out = (await tool.execute(
      { nodeId: "nope" },
      {},
    )) as { found: boolean; error?: string };
    expect(out.found).toBe(false);
    expect(out.error).toContain("nope");
  });

  it("returns node + record + edges when present", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          kind: "llm-text",
          position: { x: 0, y: 0 },
          config: { model: "anthropic/claude-haiku-4.5" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    useExecutionStore.setState({
      runId: 1,
      isRunning: false,
      records: new Map([
        [
          "n1",
          { status: "done", output: { type: "text", value: "answer" } } as never,
        ],
      ]),
    });
    const tool = getTool("read_node_state")!;
    const out = (await tool.execute(
      { nodeId: "n1" },
      {},
    )) as { found: boolean; node?: unknown; record?: unknown };
    expect(out.found).toBe(true);
    expect(out.node).toBeDefined();
    expect(out.record).toBeDefined();
  });
});

describe("read_library tool", () => {
  it("returns all assets with id/name/kind", async () => {
    useAssetStore.setState({
      assets: [
        {
          id: "soul-1",
          kind: "soul-id",
          name: "Dudu",
          tags: [],
          scope: "global",
          createdAt: 0,
          updatedAt: 0,
          customReferenceId: "ref",
          variant: "v2",
        } as never,
      ],
      selectedAssetIds: [],
      selectionAnchorId: null,
    });
    const tool = getTool("read_library")!;
    const out = (await tool.execute({}, {})) as { assets: unknown[] };
    expect(out.assets).toHaveLength(1);
  });

  it("filters by kind", async () => {
    useAssetStore.setState({
      assets: [
        {
          id: "img-1",
          kind: "image",
          name: "x",
          tags: [],
          scope: "project",
          createdAt: 0,
          updatedAt: 0,
          source: { type: "url", url: "https://x.test/x.png" },
        } as never,
        {
          id: "soul-1",
          kind: "soul-id",
          name: "Dudu",
          tags: [],
          scope: "global",
          createdAt: 0,
          updatedAt: 0,
          customReferenceId: "ref",
          variant: "v2",
        } as never,
      ],
      selectedAssetIds: [],
      selectionAnchorId: null,
    });
    const tool = getTool("read_library")!;
    const out = (await tool.execute(
      { kind: "image" },
      {},
    )) as { assets: { kind: string }[] };
    expect(out.assets).toHaveLength(1);
    expect(out.assets[0]?.kind).toBe("image");
  });
});

describe("read_gallery tool", () => {
  it("requires projectId in context", async () => {
    const tool = getTool("read_gallery")!;
    const out = (await tool.execute({}, {})) as { error?: string };
    expect(out.error).toContain("no active project");
  });

  it("forwards filters to the generation repository", async () => {
    generationRepoMocks.list.mockResolvedValue([]);
    const tool = getTool("read_gallery")!;
    await tool.execute(
      { promptContains: "noir", outputType: "image", limit: 10 },
      { projectId: "p1" },
    );
    expect(generationRepoMocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        promptContains: "noir",
        outputType: "image",
        limit: 10,
      }),
    );
  });
});

describe("read_recipe tool", () => {
  it("returns found:false when recipe id missing", async () => {
    recipeRepoMocks.get.mockResolvedValue(null);
    const tool = getTool("read_recipe")!;
    const out = (await tool.execute(
      { recipeId: "missing" },
      {},
    )) as { found: boolean; error?: string };
    expect(out.found).toBe(false);
  });

  it("returns the full recipe details when present", async () => {
    recipeRepoMocks.get.mockResolvedValue({
      id: "r1",
      ownerId: null,
      name: "X",
      description: "y",
      category: "image",
      isNode: true,
      subgraph: { version: 1, nodes: [], edges: [] },
    });
    const tool = getTool("read_recipe")!;
    const out = (await tool.execute(
      { recipeId: "r1" },
      {},
    )) as { found: boolean; recipe?: { name: string } };
    expect(out.found).toBe(true);
    expect(out.recipe?.name).toBe("X");
  });
});
