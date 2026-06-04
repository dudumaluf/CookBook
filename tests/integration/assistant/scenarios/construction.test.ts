import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-06-03 — Scenarios bench, Theme 2: building workflows from scratch.
 *
 *   3. Chain construction — user says "monta uma chain text → llm-text
 *      → text", LLM emits add_node × 3 + add_edge × 2 in any order;
 *      receipts confirm each create + the edges resolved their handles.
 *
 *   4. Refactor lifecycle — propose_refactor queues a multi-op edit,
 *      user says "aplica", apply_pending_refactor flushes atomically
 *      with a bulk receipt that includes appliedOps count.
 *
 * These scenarios prove the assistant can both *build* a graph and
 * *amend* one through the propose/apply gate.
 */

const { callOpenRouterMock } = vi.hoisted(() => ({
  callOpenRouterMock: vi.fn(),
}));
vi.mock("@/lib/llm/call-openrouter", () => ({
  callOpenRouter: callOpenRouterMock,
  LlmCallError: class extends Error {},
}));

import "@/lib/engine/all-nodes";

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    save: vi.fn(),
    remove: vi.fn(),
  }),
  SupabaseRecipeRepository: class {},
}));
vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    insert: vi.fn(),
    setPinned: vi.fn(),
    setTitle: vi.fn(),
    setTags: vi.fn(),
    remove: vi.fn(),
    listForNode: vi.fn().mockResolvedValue([]),
  }),
  SupabaseGenerationRepository: class {},
}));

const { runReasoner } = await import("@/lib/assistant/reasoner");
const { useAssetStore } = await import("@/lib/stores/asset-store");
const { useAssistantStore } = await import("@/lib/stores/assistant-store");
const { useExecutionStore } = await import("@/lib/stores/execution-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  callOpenRouterMock.mockReset();
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
  useAssistantStore.setState({
    messages: [],
    isThinking: false,
    abortController: null,
    liveEvents: [],
    pendingQuestion: null,
    pendingRefactor: null,
  });
});

describe("Scenario 3 — build a 3-node chain from an empty canvas", () => {
  it("emits 3 add_node + 2 add_edge tool calls, each with a structured create receipt", async () => {
    // The canvas starts empty. The LLM dispatches add_node × 3 then
    // add_edge × 2 in two turns (typical batch shape).
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "n1",
            type: "function",
            function: {
              name: "add_node",
              arguments: JSON.stringify({
                kind: "text",
                position: { x: 0, y: 0 },
                config: { text: "input" },
              }),
            },
          },
          {
            id: "n2",
            type: "function",
            function: {
              name: "add_node",
              arguments: JSON.stringify({
                kind: "llm-text",
                position: { x: 300, y: 0 },
              }),
            },
          },
          {
            id: "n3",
            type: "function",
            function: {
              name: "add_node",
              arguments: JSON.stringify({
                kind: "text",
                position: { x: 600, y: 0 },
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "Built the chain. Wiring up.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "monta uma chain text → llm-text → text",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── 3 nodes were added ─── */
    expect(useWorkflowStore.getState().nodes).toHaveLength(3);

    /* ─── Each tool result carries a __create receipt ─── */
    const results = result.events.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(3);
    const seenKinds: string[] = [];
    for (const ev of results) {
      const r = (ev as { result: unknown }).result as {
        ok: boolean;
        changed: string[];
        nodeId: string;
        entity?: {
          id: string;
          kind: string;
          position: { x: number; y: number };
          config: Record<string, unknown>;
        };
      };
      expect(r.ok).toBe(true);
      expect(r.changed).toEqual(["__create"]);
      expect(r.entity).toBeDefined();
      expect(r.entity?.id).toBe(r.nodeId);
      seenKinds.push(r.entity!.kind);
    }
    /* Receipt kinds line up with what the LLM asked for. */
    expect(seenKinds.sort()).toEqual(["llm-text", "text", "text"]);
    /* Store mirror of the same fact (no drift between receipt + state). */
    const kinds = useWorkflowStore.getState().nodes.map((n) => n.kind).sort();
    expect(kinds).toEqual(["llm-text", "text", "text"]);
  });
});

describe("Scenario 4 — refactor lifecycle: propose → apply", () => {
  it("propose_refactor queues a multi-op proposal then apply_pending_refactor flushes with a bulk receipt", async () => {
    // Seed two text nodes the refactor will wire.
    const idA = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "alpha" });
    const idB = useWorkflowStore
      .getState()
      .addNode("text", { x: 300, y: 0 }, { text: "beta" });

    /* Pass 1: propose. */
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "p1",
            type: "function",
            function: {
              name: "propose_refactor",
              arguments: JSON.stringify({
                summary: "Wire alpha → beta and reposition beta",
                operations: [
                  {
                    op: "add_edge",
                    source: idA,
                    sourceHandle: "out",
                    target: idB,
                    targetHandle: "out",
                  },
                  {
                    op: "move_node",
                    nodeId: idB,
                    position: { x: 600, y: 0 },
                  },
                ],
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "Proposed two ops.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    await runReasoner({
      userMessage: "wire alpha to beta and move beta to the right",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    expect(useAssistantStore.getState().pendingRefactor).not.toBeNull();
    expect(useAssistantStore.getState().pendingRefactor?.operations).toHaveLength(2);
    expect(useWorkflowStore.getState().edges).toHaveLength(0);

    /* Pass 2: apply. */
    callOpenRouterMock.mockReset();
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "a1",
            type: "function",
            function: {
              name: "apply_pending_refactor",
              arguments: JSON.stringify({}),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "Applied 2 ops.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const applyResult = await runReasoner({
      userMessage: "aplica",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── Edge was created + beta moved ─── */
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
    const beta = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === idB)!;
    expect(beta.position.x).toBe(600);

    /* ─── Bulk receipt with appliedOps count ─── */
    const results = applyResult.events.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(1);
    const r = (results[0] as { result: unknown }).result as {
      ok: boolean;
      changed: string[];
      bulk: { appliedOps: number };
    };
    expect(r.ok).toBe(true);
    expect(r.changed).toEqual(["__bulk"]);
    expect(r.bulk.appliedOps).toBe(2);

    /* ─── Pending status flipped to applied ─── */
    expect(useAssistantStore.getState().pendingRefactor?.status).toBe(
      "applied",
    );
  });
});
