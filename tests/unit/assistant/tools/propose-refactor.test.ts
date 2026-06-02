import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

/**
 * `propose_refactor` — Phase 3 tool that QUEUES a bundle of mutations
 * for the RefactorPreviewModal. The tool itself never mutates the
 * graph — it just writes `pendingRefactor` on the assistant store.
 */

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

const { getTool } = await import("@/lib/assistant/tools");
const { useAssistantStore } = await import("@/lib/stores/assistant-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  useAssistantStore.setState({
    messages: [],
    isThinking: false,
    abortController: null,
    liveEvents: [],
    pendingQuestion: null,
    pendingRefactor: null,
  });
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

async function run(args: unknown): Promise<{
  ok: boolean;
  id?: string;
  error?: string;
  message?: string;
}> {
  const tool = getTool("propose_refactor");
  if (!tool) throw new Error("propose_refactor not registered");
  return (await tool.execute(args, {})) as {
    ok: boolean;
    id?: string;
    error?: string;
    message?: string;
  };
}

describe("propose_refactor — registration", () => {
  it("is registered with the expected name", () => {
    const tool = getTool("propose_refactor");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("propose_refactor");
  });
});

describe("propose_refactor — happy path", () => {
  it("queues a multi-op proposal on the assistant store", async () => {
    const result = await run({
      summary: "Collapse two text chunks into one Concat",
      operations: [
        {
          op: "add_node",
          clientId: "newConcat",
          kind: "text-concat",
          position: { x: 100, y: 100 },
        },
        { op: "remove_node", nodeId: "old1" },
        { op: "remove_node", nodeId: "old2" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.id).toBeDefined();
    expect(result.message).toContain("queued");

    const pending = useAssistantStore.getState().pendingRefactor!;
    expect(pending).not.toBeNull();
    expect(pending.summary).toBe("Collapse two text chunks into one Concat");
    expect(pending.status).toBe("pending");
    expect(pending.operations).toHaveLength(3);
  });

  it("does NOT mutate the workflow store on its own", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    await run({
      summary: "Try to add a node",
      operations: [
        { op: "add_node", kind: "text", position: { x: 50, y: 50 } },
      ],
    });
    // The proposal is queued but NOT applied — the canvas still has
    // exactly the one pre-existing node.
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
  });
});

describe("propose_refactor — validation", () => {
  it("rejects an empty operations array", async () => {
    const result = await run({
      summary: "no-op",
      operations: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("invalid");
  });

  it("rejects a missing op field", async () => {
    const result = await run({
      summary: "broken",
      operations: [{ kind: "text", position: { x: 0, y: 0 } } as never],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("invalid");
  });

  it("rejects unknown op variants", async () => {
    const result = await run({
      summary: "broken",
      operations: [{ op: "delete_universe", nodeId: "x" } as never],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("invalid");
  });

  it("rejects an add_node missing required position", async () => {
    const result = await run({
      summary: "broken",
      operations: [{ op: "add_node", kind: "text" } as never],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("invalid");
  });
});

describe("propose_refactor — cascade dedup", () => {
  it("strips remove_edge ops that would already be cascaded by a prior remove_node", async () => {
    // Wire up the workflow snapshot the proposer will look at: one
    // edge whose source node will be removed, plus another edge that
    // stays. Only the cascade-redundant op should be filtered.
    useWorkflowStore.setState({
      nodes: [
        { id: "src", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "stay", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "dst", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        {
          id: "src-out-dst-user",
          source: "src",
          sourceHandle: "out",
          target: "dst",
          targetHandle: "user",
        },
        {
          id: "stay-out-dst-system",
          source: "stay",
          sourceHandle: "out",
          target: "dst",
          targetHandle: "system",
        },
      ],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await run({
      summary: "drop src + cleanup",
      operations: [
        { op: "remove_node", nodeId: "src" },
        { op: "remove_edge", edgeId: "src-out-dst-user" }, // redundant
        { op: "remove_edge", edgeId: "stay-out-dst-system" }, // keeps
      ],
    });
    expect(result.ok).toBe(true);
    const pending = useAssistantStore.getState().pendingRefactor!;
    expect(pending.operations).toHaveLength(2);
    expect(pending.operations).toEqual([
      { op: "remove_node", nodeId: "src" },
      { op: "remove_edge", edgeId: "stay-out-dst-system" },
    ]);
    expect(result.message).toContain("filtered");
  });

  it("leaves the proposal untouched when nothing is redundant", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await run({
      summary: "swap",
      operations: [
        { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
        { op: "remove_node", nodeId: "a" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.message).not.toContain("filtered");
    const pending = useAssistantStore.getState().pendingRefactor!;
    expect(pending.operations).toHaveLength(2);
  });
});
