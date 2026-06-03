import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-06-03 — Tier 2 integration test: "apply for me" chain.
 *
 * Pins the exact bug class that hit the user previously: the LLM
 * said "Aplicando o refactor agora! 🚀" but emitted no tool call,
 * the modal stayed open, and the canvas didn't change. The fix
 * was the `apply_pending_refactor` tool — this test asserts the
 * three-step chain still works end-to-end:
 *
 *   1. LLM calls `propose_refactor` → store.pendingRefactor set,
 *      canvas untouched.
 *   2. User types "apply for me" → second `runReasoner` call.
 *   3. LLM calls `apply_pending_refactor` → applyPendingRefactor
 *      runs, canvas mutated atomically, pendingRefactor cleared.
 *
 * The mock LLM sequencing mirrors what we'd see in production with
 * a well-behaved Anthropic / OpenAI tool-call response.
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

describe("apply-for-me chain — end-to-end", () => {
  it("propose_refactor → user 'apply for me' → apply_pending_refactor mutates canvas atomically", async () => {
    // Seed a graph the refactor will mutate.
    const idA = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "alpha" });
    const idB = useWorkflowStore
      .getState()
      .addNode("text", { x: 200, y: 0 }, { text: "beta" });

    /* ────── First reasoner pass — proposes a refactor ────── */

    callOpenRouterMock
      // Turn 1: propose_refactor (queue an add_edge between A → B).
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "call-propose",
            type: "function",
            function: {
              name: "propose_refactor",
              arguments: JSON.stringify({
                summary: "Wire alpha → beta",
                operations: [
                  {
                    op: "add_edge",
                    source: idA,
                    sourceHandle: "out",
                    target: idB,
                    targetHandle: "out",
                  },
                ],
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      // Turn 2: final text ("queued, awaiting your OK").
      .mockResolvedValueOnce({
        text: "Proposed. Apply when ready.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const proposeResult = await runReasoner({
      userMessage: "wire alpha to beta",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    // Pending proposal queued; canvas NOT yet mutated.
    expect(proposeResult.finalText).toBe("Proposed. Apply when ready.");
    expect(useAssistantStore.getState().pendingRefactor).not.toBeNull();
    expect(
      useAssistantStore.getState().pendingRefactor?.summary,
    ).toBe("Wire alpha → beta");
    expect(useWorkflowStore.getState().edges).toHaveLength(0);

    /* ────── Second reasoner pass — user says "apply for me" ────── */

    callOpenRouterMock.mockReset();
    callOpenRouterMock
      // Turn 1: apply_pending_refactor (no args).
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "call-apply",
            type: "function",
            function: {
              name: "apply_pending_refactor",
              arguments: JSON.stringify({}),
            },
          },
        ],
        costUsd: 0.001,
      })
      // Turn 2: final text.
      .mockResolvedValueOnce({
        text: "Done — applied 1 op.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const applyResult = await runReasoner({
      userMessage: "apply for me",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    // Apply succeeded — canvas mutated, refactor marked applied (the
    // RefactorPreviewModal clears the pending record on dismiss; the
    // tool itself transitions status to `"applied"` and stops there).
    expect(applyResult.finalText).toBe("Done — applied 1 op.");
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
    const edge = useWorkflowStore.getState().edges[0]!;
    expect(edge.source).toBe(idA);
    expect(edge.target).toBe(idB);
    expect(useAssistantStore.getState().pendingRefactor?.status).toBe(
      "applied",
    );

    // Verify the tool_call event sequence was the expected pair (one per pass).
    const proposeCalls = proposeResult.events.filter(
      (e) => e.type === "tool_call",
    );
    expect(proposeCalls).toHaveLength(1);
    if (proposeCalls[0]?.type === "tool_call") {
      expect(proposeCalls[0].toolName).toBe("propose_refactor");
    }
    const applyCalls = applyResult.events.filter(
      (e) => e.type === "tool_call",
    );
    expect(applyCalls).toHaveLength(1);
    if (applyCalls[0]?.type === "tool_call") {
      expect(applyCalls[0].toolName).toBe("apply_pending_refactor");
    }
  });

  it("apply_pending_refactor with no pending proposal returns a clear error to the LLM", async () => {
    // No pendingRefactor seeded — the LLM jumped the gun.
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "call-apply",
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
        text: "Nothing pending — sorry.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "apply for me",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    // The tool_result event should carry the error message; the
    // canvas + pending state stay untouched.
    const toolResults = result.events.filter(
      (e) => e.type === "tool_result",
    );
    expect(toolResults).toHaveLength(1);
    if (toolResults[0]?.type === "tool_result") {
      const payload = toolResults[0].result as {
        ok: boolean;
        error?: string;
      };
      expect(payload.ok).toBe(false);
      expect(payload.error).toMatch(/no pending refactor/i);
    }
    expect(useWorkflowStore.getState().nodes).toHaveLength(0);
    expect(useAssistantStore.getState().pendingRefactor).toBeNull();
  });
});
