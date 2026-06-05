import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-06-05 — ADR-0071 integration test.
 *
 * The user kept hitting "the assistant said it changed something but
 * nothing changed". The forensic root cause: the model was emitting a
 * fake `[tools fired: update_node_config: text_x {text}]` token in
 * its final answer WITHOUT actually invoking the tool. The system
 * uses that exact format to remind the model of past-turn receipts
 * (in `buildConversationMessages`), and the model learned to LARP it
 * as a way to claim work it never did.
 *
 * ADR-0071 stacks five defenses; this test pins the auto-retry one:
 *
 *   1. Turn 1: model returns a hallucinated final answer (no tool
 *      calls, prose contains `[tools fired: …]`).
 *   2. Reasoner detects the hard contradiction, injects a corrective
 *      `user`-role nudge, loops.
 *   3. Turn 2: model now emits a REAL `update_node_config` tool call.
 *   4. Tool dispatches, mutates the store.
 *   5. Turn 3: model emits a clean final answer that quotes the
 *      receipt (no system-format token).
 *
 * The test asserts the full OBSERVABLE chain: hallucination narration
 * fires, the right tool eventually runs, the store mutates, and the
 * final text is clean. A regression in any defense layer (regex
 * detector, retry budget, corrective nudge, loop continue) lights up
 * here.
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

describe("ADR-0071 — auto-retry on hallucinated tool calls", () => {
  it("reasoner detects [tools fired:] echo, injects a corrective turn, and the retry produces a real tool call", async () => {
    const ws = useWorkflowStore.getState();
    const id = ws.addNode("text", { x: 0, y: 0 }, { text: "OLD" });
    useWorkflowStore.setState({ selectedNodeIds: [id] });

    callOpenRouterMock
      // Turn 1 — the model lies. No tool calls, but the prose echoes
      // `[tools fired: ...]` to fake successful execution.
      .mockResolvedValueOnce({
        text: `✓ \`${id}.text\` agora é "NEW".\n\n[tools fired: update_node_config: ${id} {text}]`,
        toolCalls: [],
        costUsd: 0.001,
        finishReason: "stop",
      })
      // Turn 2 — after the corrective nudge, the model issues a REAL
      // update_node_config call.
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "call-real",
            type: "function",
            function: {
              name: "update_node_config",
              arguments: JSON.stringify({
                nodeId: id,
                config: { text: "NEW" },
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      // Turn 3 — clean final answer, no system-format echo.
      .mockResolvedValueOnce({
        text: `✓ \`${id}.text\` foi atualizado para "NEW".`,
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "muda esse pra NEW",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── Hallucination narration emitted ─── */
    const narrations = result.events.filter((e) => e.type === "narration");
    expect(
      narrations.some((n) =>
        (n as { content: string }).content.toLowerCase().includes(
          "hallucinated tool call",
        ),
      ),
    ).toBe(true);

    /* ─── A REAL update_node_config call eventually fired ─── */
    const calls = result.events.filter((e) => e.type === "tool_call");
    expect(calls).toHaveLength(1);
    expect(
      (calls[0] as { toolName: string }).toolName,
    ).toBe("update_node_config");

    /* ─── Store actually mutated ─── */
    expect(
      (
        useWorkflowStore.getState().nodes.find((n) => n.id === id)!
          .config as { text: string }
      ).text,
    ).toBe("NEW");

    /* ─── Final text is clean (no system-format echo) ─── */
    expect(result.finalText).toBeDefined();
    expect(result.finalText).not.toMatch(/\[tools fired:/);
    expect(result.finalText).not.toMatch(/<system-/);
    expect(result.finalText).toContain("NEW");

    /* ─── LLM was called THREE times: lie + retry + clean final ─── */
    expect(callOpenRouterMock).toHaveBeenCalledTimes(3);
  });

  it("retry budget caps at 1 — a stubborn model that lies twice still terminates", async () => {
    const ws = useWorkflowStore.getState();
    ws.addNode("text", { x: 0, y: 0 }, { text: "OLD" });

    // Both turns lie identically. After 1 retry, the loop must stop
    // and return the second-turn lie as `finalText` (chat-sheet's
    // HallucinatedProseBlock will hide it from the user).
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "✓ done. [tools fired: update_node_config]",
        toolCalls: [],
        costUsd: 0.001,
        finishReason: "stop",
      })
      .mockResolvedValueOnce({
        text: "✓ really done this time. [tools fired: update_node_config]",
        toolCalls: [],
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "muda x",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    // Exactly 2 LLM calls (the original lie + 1 retry that still lied).
    expect(callOpenRouterMock).toHaveBeenCalledTimes(2);
    // The final text is the second lie — but the chat-sheet's hard
    // contradiction detector + HallucinatedProseBlock take over from
    // here. The reasoner doesn't infinite-loop.
    expect(result.finalText).toContain("really done this time");
  });

  it("does NOT retry when the final text is honest (no format echo)", async () => {
    callOpenRouterMock.mockResolvedValueOnce({
      text: "Sem entender bem, deixa eu te perguntar — qual node você quer mudar?",
      toolCalls: [],
      costUsd: 0.001,
      finishReason: "stop",
    });

    await runReasoner({
      userMessage: "muda algo",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    // No retry — the final text is clean prose.
    expect(callOpenRouterMock).toHaveBeenCalledTimes(1);
  });
});
