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

describe("applyRefactor — cascade-aware remove_edge", () => {
  it("treats remove_edge for an edge already swept by a prior remove_node as success", async () => {
    // Setup: two nodes with one edge between them. The proposal removes
    // the source node (cascading the edge) AND then explicitly tries to
    // remove the same edge — the kind of redundant batch the LLM tends
    // to emit when it can't see edge ids in its context.
    useWorkflowStore.setState({
      nodes: [
        { id: "src", kind: "text", position: { x: 0, y: 0 }, config: {} },
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
      ],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await applyRefactor(
      refactor([
        { op: "remove_node", nodeId: "src" },
        { op: "remove_edge", edgeId: "src-out-dst-user" },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.appliedCount).toBe(2);
    const state = useWorkflowStore.getState();
    expect(state.nodes.map((n) => n.id)).toEqual(["dst"]);
    expect(state.edges).toEqual([]);
  });

  it("still surfaces a stale edge id (truly missing, no cascade explanation)", async () => {
    // Edge id that doesn't exist in the snapshot AND is not incident to
    // any node we're removing in the batch — surfacing the failure here
    // protects against silent typos in the assistant's tool calls.
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await applyRefactor(
      refactor([{ op: "remove_edge", edgeId: "nonexistent-edge" }]),
    );
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("nonexistent-edge");
  });

  it("cascades correctly even when remove_node is interleaved with other ops", async () => {
    // Proposal mirrors the real-world failure: remove a node, do other
    // work, then explicitly remove an edge that was already cascaded
    // out by the earlier remove_node. The original bug report had this
    // exact shape (Op 1 remove_node, Op 8 remove_edge incident to it).
    useWorkflowStore.setState({
      nodes: [
        { id: "old", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "keep", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        {
          id: "old-out-keep-prompt",
          source: "old",
          sourceHandle: "out",
          target: "keep",
          targetHandle: "prompt",
        },
      ],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await applyRefactor(
      refactor([
        { op: "remove_node", nodeId: "old" },
        { op: "add_node", kind: "text", position: { x: 100, y: 100 } },
        { op: "remove_edge", edgeId: "old-out-keep-prompt" },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.appliedCount).toBe(3);
  });
});

describe("applyRefactor — idempotent add_edge", () => {
  it("treats add_edge for an exact-duplicate wire as success", async () => {
    // 2026-06-02 regression: assistant proposed `add_edge ta.text →
    // lt.user` but that exact wire already existed; addEdge in the
    // store returned undefined; applyOne flagged it; whole batch
    // rolled back. The fix: detect exact duplicates (same source +
    // sourceHandle + target + targetHandle) and treat them as no-op
    // success. Any OTHER reason addEdge can return undefined still
    // surfaces as a real error.
    useWorkflowStore.setState({
      nodes: [
        { id: "ta", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "lt", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        {
          id: "edge_ta_lt_user",
          source: "ta",
          sourceHandle: "text",
          target: "lt",
          targetHandle: "user",
        },
      ],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await applyRefactor(
      refactor([
        // Duplicate of the existing edge — should be silent success.
        {
          op: "add_edge",
          source: "ta",
          sourceHandle: "text",
          target: "lt",
          targetHandle: "user",
        },
        // Brand new edge — should land for real.
        {
          op: "add_edge",
          source: "ta",
          sourceHandle: "text",
          target: "lt",
          targetHandle: "image-0",
        },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.appliedCount).toBe(2);
    const state = useWorkflowStore.getState();
    // Original edge stays + the new one was added; no duplicate row.
    expect(state.edges).toHaveLength(2);
    expect(
      state.edges.some(
        (e) =>
          e.target === "lt" &&
          e.targetHandle === "image-0" &&
          e.source === "ta",
      ),
    ).toBe(true);
  });

  it("still rejects an add_edge whose target handle is occupied by a DIFFERENT upstream", async () => {
    // Single-arity port already wired from a different source — the
    // op is genuinely conflicting (not a duplicate), so the executor
    // must surface the failure with an actionable hint instead of
    // silently swallowing it.
    useWorkflowStore.setState({
      nodes: [
        { id: "ta", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "tb", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "lt", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        {
          id: "edge_ta_lt_user",
          source: "ta",
          sourceHandle: "text",
          target: "lt",
          targetHandle: "user",
        },
      ],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await applyRefactor(
      refactor([
        {
          op: "add_edge",
          source: "tb", // different upstream
          sourceHandle: "text",
          target: "lt",
          targetHandle: "user",
        },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("rejected");
    expect(result.error).toContain("port already wired");
    // Hint mentions the existing occupant so the LLM knows what to remove.
    expect(result.error).toContain("edge_ta_lt_user");
  });

  it("rejects an add_edge that would form a self-loop with a clear message", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "n1", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await applyRefactor(
      refactor([
        {
          op: "add_edge",
          source: "n1",
          sourceHandle: "out",
          target: "n1",
          targetHandle: "in",
        },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("self-loop");
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
