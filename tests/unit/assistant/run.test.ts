import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callOpenRouterMock = vi.fn();
vi.mock("@/lib/llm/call-openrouter", () => ({
  callOpenRouter: callOpenRouterMock,
  LlmCallError: class extends Error {},
}));

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

// Slice 7.2 — knowledge bundle now pulls from cookbook_generations
// (gallery) too. Stub it to keep these unit tests off the network.
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

const { planFromAssistant, executePlan } = await import(
  "@/lib/assistant/run"
);
const { useAssetStore } = await import("@/lib/stores/asset-store");
const { useExecutionStore } = await import("@/lib/stores/execution-store");
const { useProjectStore } = await import("@/lib/stores/project-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  callOpenRouterMock.mockReset();
  Object.values(recipeRepoMocks).forEach((m) => m.mockReset());
  generationRepoMocks.list.mockReset();
  generationRepoMocks.list.mockResolvedValue([]);
  useAssetStore.setState({
    assets: [],
    selectedAssetIds: [],
    selectionAnchorId: null,
  });
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
  useExecutionStore.setState({
    runId: 0,
    isRunning: false,
    records: new Map(),
  });
  // Slice 7.2 — assistant requires an active project. Tests that
  // exercise planFromAssistant must seed one.
  useProjectStore.setState({ id: "test-project-1", name: "Test" });
  recipeRepoMocks.list.mockResolvedValue([
    {
      id: "recipe-1",
      ownerId: null,
      name: "Soul Image Burst",
      description: "",
      category: "image",
      subgraph: { version: 1, nodes: [], edges: [] },
      isNode: false,
      parentRecipeId: null,
      createdAt: "",
    },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("planFromAssistant", () => {
  it("parses a valid JSON plan from the LLM", async () => {
    const plan = {
      reasoning: "ok",
      steps: [{ kind: "run" }],
      estimatedCostUsd: 0.05,
    };
    callOpenRouterMock.mockResolvedValueOnce({
      text: JSON.stringify(plan),
      model: "anthropic/claude-sonnet-4.5",
      costUsd: 0.001,
    });
    const result = await planFromAssistant({
      userMessage: "go!",
      ownerId: "user-1",
      signal: new AbortController().signal,
    });
    expect(result.plan).toBeDefined();
    expect(result.plan?.reasoning).toBe("ok");
    expect(result.error).toBeUndefined();
  });

  it("strips ```json fences if the LLM included them", async () => {
    const plan = {
      reasoning: "fenced",
      steps: [],
      estimatedCostUsd: 0,
    };
    callOpenRouterMock.mockResolvedValueOnce({
      text: "```json\n" + JSON.stringify(plan) + "\n```",
      model: "anthropic/claude-sonnet-4.5",
    });
    const result = await planFromAssistant({
      userMessage: "go!",
      ownerId: "user-1",
      signal: new AbortController().signal,
    });
    expect(result.plan?.reasoning).toBe("fenced");
  });

  it("returns an error when LLM response isn't valid JSON", async () => {
    callOpenRouterMock.mockResolvedValueOnce({
      text: "Sure thing! Let me think about it.",
      model: "anthropic/claude-sonnet-4.5",
    });
    const result = await planFromAssistant({
      userMessage: "go!",
      ownerId: "user-1",
      signal: new AbortController().signal,
    });
    expect(result.plan).toBeUndefined();
    expect(result.error).toContain("did not return valid JSON");
  });

  it("returns an error when JSON shape doesn't match schema", async () => {
    callOpenRouterMock.mockResolvedValueOnce({
      text: JSON.stringify({ reasoning: 5 /* should be string */, steps: [] }),
      model: "anthropic/claude-sonnet-4.5",
    });
    const result = await planFromAssistant({
      userMessage: "go!",
      ownerId: "user-1",
      signal: new AbortController().signal,
    });
    expect(result.plan).toBeUndefined();
    expect(result.error).toContain("validation");
  });

  it("returns an error when LLM call itself fails", async () => {
    callOpenRouterMock.mockRejectedValueOnce(
      new Error("upstream timeout"),
    );
    const result = await planFromAssistant({
      userMessage: "go!",
      ownerId: "user-1",
      signal: new AbortController().signal,
    });
    expect(result.error).toContain("LLM call failed");
  });
});

describe("executePlan", () => {
  it("clear-canvas wipes nodes + edges", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "n1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await executePlan({
      reasoning: "",
      steps: [{ kind: "clear-canvas" }],
      estimatedCostUsd: 0,
    });
    expect(result.ok).toBe(true);
    expect(useWorkflowStore.getState().nodes).toHaveLength(0);
  });

  it("instantiate-recipe spawns saved subgraph and tracks node id mapping", async () => {
    recipeRepoMocks.get.mockResolvedValueOnce({
      id: "recipe-1",
      ownerId: null,
      name: "Test",
      description: null,
      category: null,
      subgraph: {
        version: 1,
        nodes: [
          {
            id: "saved-text",
            kind: "text",
            position: { x: 0, y: 0 },
            config: { text: "hi" },
          },
        ],
        edges: [],
      },
      isNode: false,
      parentRecipeId: null,
      createdAt: "",
    });
    const result = await executePlan({
      reasoning: "",
      steps: [
        {
          kind: "instantiate-recipe",
          recipeId: "recipe-1",
          position: { x: 50, y: 50 },
        },
        {
          kind: "set-node-config",
          nodeId: "saved-text",
          config: { text: "patched" },
        },
      ],
      estimatedCostUsd: 0,
    });
    expect(result.ok).toBe(true);
    const nodes = useWorkflowStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect((nodes[0]!.config as { text: string }).text).toBe("patched");
  });

  it("link-soul-id patches assetId on the node mapped from recipe id", async () => {
    recipeRepoMocks.get.mockResolvedValueOnce({
      id: "recipe-1",
      ownerId: null,
      name: "Test",
      description: null,
      category: null,
      subgraph: {
        version: 1,
        nodes: [
          {
            id: "soul-id",
            kind: "soul-id",
            position: { x: 0, y: 0 },
            config: {},
          },
        ],
        edges: [],
      },
      isNode: false,
      parentRecipeId: null,
      createdAt: "",
    });
    const result = await executePlan({
      reasoning: "",
      steps: [
        {
          kind: "instantiate-recipe",
          recipeId: "recipe-1",
          position: { x: 0, y: 0 },
        },
        {
          kind: "link-soul-id",
          nodeId: "soul-id",
          assetId: "asset-uuid-XYZ",
        },
      ],
      estimatedCostUsd: 0,
    });
    expect(result.ok).toBe(true);
    const nodes = useWorkflowStore.getState().nodes;
    expect((nodes[0]!.config as { assetId: string }).assetId).toBe(
      "asset-uuid-XYZ",
    );
  });

  it("run kicks off startRun and reports the runId", async () => {
    const startRunMock = vi.fn();
    useExecutionStore.setState({
      runId: 7,
      isRunning: false,
      records: new Map(),
      startRun: startRunMock as never,
    } as never);
    const result = await executePlan({
      reasoning: "",
      steps: [{ kind: "run" }],
      estimatedCostUsd: 0,
    });
    expect(startRunMock).toHaveBeenCalledTimes(1);
    expect(result.runId).toBe(7);
  });

  it("returns ok=false with informative error when recipe is missing", async () => {
    recipeRepoMocks.get.mockResolvedValueOnce(null);
    const result = await executePlan({
      reasoning: "",
      steps: [
        {
          kind: "instantiate-recipe",
          recipeId: "missing-recipe",
          position: { x: 0, y: 0 },
        },
      ],
      estimatedCostUsd: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });
});
