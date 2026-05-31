import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

/**
 * `refactor-apply` — atomic dispatcher for a `PendingRefactor`.
 *
 * Verifies:
 *   - happy path applies all ops to the workflow store,
 *   - one bad op rolls every preceding op back,
 *   - cross-op clientId references resolve to real ids,
 *   - assistant-store status flips through pending → applied / failed.
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

const { applyRefactor, applyPendingRefactor } = await import(
  "@/lib/assistant/refactor-apply"
);
const { useAssistantStore } = await import("@/lib/stores/assistant-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

import type { PendingRefactor } from "@/lib/assistant/refactor-types";

function refactor(
  ops: PendingRefactor["operations"],
  summary = "test refactor",
): PendingRefactor {
  return {
    id: `r_${Math.random()}`,
    summary,
    operations: ops,
    status: "pending",
    proposedAt: Date.now(),
  };
}

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
  useAssistantStore.setState({
    messages: [],
    isThinking: false,
    abortController: null,
    liveEvents: [],
    pendingQuestion: null,
    pendingRefactor: null,
  });
});

describe("applyRefactor — happy path", () => {
  it("applies a single add_node op", async () => {
    const result = await applyRefactor(
      refactor([
        { op: "add_node", kind: "text", position: { x: 50, y: 50 } },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
  });

  it("resolves clientId refs in subsequent add_edge ops", async () => {
    // Preexisting node; we add a new node with a clientId, then connect
    // them. The applier should map clientId -> real id under the hood.
    useWorkflowStore.setState({
      nodes: [
        {
          id: "existing",
          kind: "llm-text",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await applyRefactor(
      refactor([
        {
          op: "add_node",
          clientId: "newText",
          kind: "text",
          position: { x: 100, y: 100 },
        },
        {
          op: "add_edge",
          source: "newText",
          sourceHandle: "out",
          target: "existing",
          targetHandle: "user",
        },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.appliedCount).toBe(2);
    const realId = result.newNodeIds["newText"];
    expect(realId).toBeDefined();
    const edges = useWorkflowStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]!.source).toBe(realId);
  });

  it("supports update_node_config ops", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "a",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "old" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await applyRefactor(
      refactor([
        { op: "update_node_config", nodeId: "a", config: { text: "new" } },
      ]),
    );
    expect(result.ok).toBe(true);
    const node = useWorkflowStore.getState().nodes[0]!;
    const cfg = node.config as { text: string };
    expect(cfg.text).toBe("new");
  });

  it("supports remove_node ops", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "b", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await applyRefactor(
      refactor([{ op: "remove_node", nodeId: "a" }]),
    );
    expect(result.ok).toBe(true);
    const ids = useWorkflowStore.getState().nodes.map((n) => n.id);
    expect(ids).toEqual(["b"]);
  });
});

describe("applyRefactor — rollback on failure", () => {
  it("rolls every preceding op back when a later op fails", async () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "real",
          kind: "text",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await applyRefactor(
      refactor([
        // First op succeeds — adds a new node.
        { op: "add_node", kind: "text", position: { x: 50, y: 50 } },
        // Second op fails — there's no node "ghost".
        { op: "remove_node", nodeId: "ghost" },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.appliedCount).toBe(1);
    expect(result.error?.toLowerCase()).toContain("ghost");
    // Snapshot restore: the node added by op 1 is gone.
    const ids = useWorkflowStore.getState().nodes.map((n) => n.id);
    expect(ids).toEqual(["real"]);
  });

  it("does not double-apply when failing on op 1 of N", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await applyRefactor(
      refactor([
        { op: "remove_node", nodeId: "missing" }, // fails
        { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.appliedCount).toBe(0);
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
  });

  it("rejects unknown node kinds without mutating", async () => {
    const result = await applyRefactor(
      refactor([
        { op: "add_node", kind: "fictional-kind", position: { x: 0, y: 0 } },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(useWorkflowStore.getState().nodes).toEqual([]);
  });

  it("rejects add_edge between non-existent nodes", async () => {
    const result = await applyRefactor(
      refactor([
        {
          op: "add_edge",
          source: "ghost",
          sourceHandle: "out",
          target: "phantom",
          targetHandle: "user",
        },
      ]),
    );
    expect(result.ok).toBe(false);
  });
});

describe("applyPendingRefactor — assistant-store integration", () => {
  it("flips status to applied on success", async () => {
    useAssistantStore.setState({
      messages: [],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: refactor([
        { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
      ]),
    });
    const result = await applyPendingRefactor();
    expect(result.ok).toBe(true);
    expect(useAssistantStore.getState().pendingRefactor!.status).toBe(
      "applied",
    );
  });

  it("flips status to failed and records the error on rollback", async () => {
    useAssistantStore.setState({
      messages: [],
      isThinking: false,
      abortController: null,
      liveEvents: [],
      pendingQuestion: null,
      pendingRefactor: refactor([
        { op: "remove_node", nodeId: "missing" },
      ]),
    });
    const result = await applyPendingRefactor();
    expect(result.ok).toBe(false);
    const pending = useAssistantStore.getState().pendingRefactor!;
    expect(pending.status).toBe("failed");
    expect(pending.error).toBeDefined();
  });

  it("returns ok:false when no pending refactor exists", async () => {
    const result = await applyPendingRefactor();
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("no pending");
  });
});
