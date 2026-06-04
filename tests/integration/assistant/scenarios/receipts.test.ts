import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-06-03 — Scenarios bench, Theme 1: post-write receipts (anti-confabulation).
 *
 * Two scenarios pinning the structural fix that closed the user's
 * screenshot bug ("atualizei pra 10" + node body still says 5):
 *
 *   1. Real change   → receipt cited verbatim, before/after correct,
 *      LLM final text references the new value (proof the LLM read
 *      the receipt).
 *   2. No-op patch   → tool returns `ok: false`, LLM is forced to
 *      reconcile via `read_node_state` instead of confabulating.
 *
 * The mock LLM scripts what a well-behaved Sonnet 4.6 would emit;
 * the test asserts the OBSERVABLE chain (events + store state +
 * tool result fields) so a future regression in any of the three
 * anti-confabulation layers (backend receipt / prompt rule / UI)
 * lights up the same scenario.
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

describe("Scenario 1 — patch with real change emits a verifiable diff receipt", () => {
  it("update_node_config returns { changed, before, after } and the LLM's final text quotes the new value", async () => {
    // Reproduce the screenshot setup: a Text node with a count placeholder.
    const textId = useWorkflowStore
      .getState()
      .addNode(
        "text",
        { x: 0, y: 0 },
        { text: "Separate each of the 5 environment description prompts." },
      );

    // The LLM does what it should: patch the text. Note the *new* value
    // — we'll assert the receipt + final text both reference 10.
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "update_node_config",
              arguments: JSON.stringify({
                nodeId: textId,
                config: {
                  text: "Separate each of the 10 environment description prompts.",
                },
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: `✓ atualizei \`${textId}.text\` → "Separate each of the 10 environment description prompts."`,
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "muda pra 10 environments",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── 1. Tool was called with the right args ─── */
    const calls = result.events.filter((e) => e.type === "tool_call");
    expect(calls).toHaveLength(1);
    expect((calls[0] as { toolName: string }).toolName).toBe(
      "update_node_config",
    );

    /* ─── 2. Tool result carries a structured receipt ─── */
    const results = result.events.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(1);
    const payload = (results[0] as { result: unknown }).result as {
      ok: boolean;
      changed: string[];
      before: { text: string };
      after: { text: string };
      nodeId: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.changed).toEqual(["text"]);
    expect(payload.before.text).toBe(
      "Separate each of the 5 environment description prompts.",
    );
    expect(payload.after.text).toBe(
      "Separate each of the 10 environment description prompts.",
    );
    expect(payload.nodeId).toBe(textId);

    /* ─── 3. Workflow store actually mutated to the new value ─── */
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === textId)!;
    expect((node.config as { text: string }).text).toBe(
      "Separate each of the 10 environment description prompts.",
    );

    /* ─── 4. LLM final text cites the new value (anti-confabulation) ─── */
    expect(result.finalText).toContain("10");
    expect(result.finalText).toContain(textId);
  });
});

describe("Scenario 2 — no-op patch forces the LLM to reconcile, never claim success", () => {
  it("update_node_config with a value that already matches returns ok:false and the LLM does NOT claim 'atualizei'", async () => {
    // Seed a Text node already at the target value.
    const textId = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "already 10" });

    // The LLM patches with the same value (typical confabulation
    // setup: it thinks it needs to write "10" not noticing the node
    // already has it).
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "call-noop",
            type: "function",
            function: {
              name: "update_node_config",
              arguments: JSON.stringify({
                nodeId: textId,
                config: { text: "already 10" },
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      // Second turn — receiving ok:false with attemptedPatch, the
      // well-behaved LLM reads the real state and explains.
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "call-read",
            type: "function",
            function: {
              name: "read_node_state",
              arguments: JSON.stringify({ nodeId: textId }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: `O nó \`${textId}\` já estava com text="already 10" — nada mudou.`,
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "muda pra 10",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── 1. First tool result is ok:false with no-op + attemptedPatch ─── */
    const results = result.events.filter((e) => e.type === "tool_result");
    expect(results.length).toBeGreaterThanOrEqual(1);
    const firstResult = (results[0] as { result: unknown }).result as {
      ok: boolean;
      error?: string;
      attemptedPatch?: { text: string };
      nodeId?: string;
    };
    expect(firstResult.ok).toBe(false);
    expect(firstResult.error).toContain("no-op");
    expect(firstResult.attemptedPatch).toEqual({ text: "already 10" });
    expect(firstResult.nodeId).toBe(textId);

    /* ─── 2. LLM responded by calling read_node_state (reconciliation) ─── */
    const calls = result.events.filter((e) => e.type === "tool_call");
    expect(calls).toHaveLength(2);
    expect((calls[0] as { toolName: string }).toolName).toBe(
      "update_node_config",
    );
    expect((calls[1] as { toolName: string }).toolName).toBe(
      "read_node_state",
    );

    /* ─── 3. LLM final text does NOT claim the change happened ─── */
    expect(result.finalText).not.toMatch(/atualizei|updated|✓/i);
    expect(result.finalText).toContain("já estava");

    /* ─── 4. Workflow store unchanged ─── */
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === textId)!;
    expect((node.config as { text: string }).text).toBe("already 10");
  });
});
