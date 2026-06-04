import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-06-04 — ADR-0069 F8.
 *
 * Lock the duplicate-text-node precision bug: the user duplicates a Text
 * node, selects the duplicate, asks "muda esse para X". Pre-ADR-0069 the
 * LLM would frequently patch the ORIGINAL because the canvas summary
 * showed two near-identical rows and the only "selected" signal was a
 * trailing `Selected: <id>` line — easy to miss. The duplicate stayed
 * unchanged while the chat said "feito ✓" and the user discovered the
 * silent failure only by looking at the canvas.
 *
 * Three layers of protection were stacked in ADR-0069:
 *   - F1: dedicated `## FOCUSED NODE` block with full config.
 *   - F2: inline `· SELECTED` markers in the canvas summary.
 *   - F3: explicit deictic-edits rule in `instructions.ts`.
 *   - F6: `update_node_config({ nodeId? })` defaults to `selectedNodeIds[0]`
 *     so even if the LLM omits the id, it still resolves to the user's
 *     selection (instead of "the first node that matches the text").
 *
 * Two scenarios pin those layers:
 *   1. **LLM uses the FOCUSED NODE id explicitly.** The receipt should
 *      show the duplicate id, the duplicate's `config.text` should
 *      change, and the original should remain untouched.
 *   2. **LLM omits `nodeId`** (relies on the F6 selection-default).
 *      Same expected outcome: the duplicate (the selected node) is the
 *      one that mutates, the original is untouched, and the receipt
 *      carries `selectionDefault: true`.
 *
 * The mock LLM mirrors what a well-behaved Claude/Sonnet would emit
 * given the new prompt context. We assert the OBSERVABLE chain (tool
 * args + tool result + store state + receipt fields) so a regression
 * in any of the four ADR-0069 layers lights up here.
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
const { useCanvasUiStore } = await import("@/lib/stores/canvas-ui-store");

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
  useCanvasUiStore.getState().clearAllPulses();
});

/**
 * Set up the canonical "user duplicated a text node and selected the
 * duplicate" scenario.
 *
 * Returns both ids so individual tests can assert which one mutated.
 */
function setupDuplicateScenario() {
  const ws = useWorkflowStore.getState();
  const originalId = ws.addNode("text", { x: 40, y: 40 }, { text: "Foo" });
  const duplicateId = ws.addNode(
    "text",
    { x: 70, y: 70 },
    { text: "Foo" },
  );
  // The user has just duplicated and the paste-handler set the new node
  // as the only selection — exact same path the canvas takes after Cmd-D.
  useWorkflowStore.setState({ selectedNodeIds: [duplicateId] });
  return { originalId, duplicateId };
}

describe("ADR-0069 — duplicate-text-node precision", () => {
  it("LLM patches the SELECTED duplicate, not the original (explicit nodeId)", async () => {
    const { originalId, duplicateId } = setupDuplicateScenario();

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
                nodeId: duplicateId,
                config: { text: "Foo V2" },
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: `✓ \`${duplicateId}.text\` agora é "Foo V2".`,
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "muda esse texto pra Foo V2",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── Tool received the duplicate id, not the original ─── */
    const calls = result.events.filter((e) => e.type === "tool_call");
    expect(calls).toHaveLength(1);
    const toolCall = calls[0] as {
      toolName: string;
      arguments: { nodeId?: string };
    };
    expect(toolCall.toolName).toBe("update_node_config");
    expect(toolCall.arguments.nodeId).toBe(duplicateId);
    expect(toolCall.arguments.nodeId).not.toBe(originalId);

    /* ─── Receipt confirms the duplicate mutated, original untouched ─── */
    const results = result.events.filter((e) => e.type === "tool_result");
    const payload = (results[0] as { result: unknown }).result as {
      ok: boolean;
      nodeId: string;
      changed: string[];
      before: { text: string };
      after: { text: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.nodeId).toBe(duplicateId);
    expect(payload.before.text).toBe("Foo");
    expect(payload.after.text).toBe("Foo V2");

    /* ─── Store: only the duplicate changed; original is intact ─── */
    const ws = useWorkflowStore.getState();
    const dup = ws.nodes.find((n) => n.id === duplicateId)!;
    const orig = ws.nodes.find((n) => n.id === originalId)!;
    expect((dup.config as { text: string }).text).toBe("Foo V2");
    expect((orig.config as { text: string }).text).toBe("Foo");

    /* ─── F7 pulse fired on the duplicate (not the original) ─── */
    expect(useCanvasUiStore.getState().recentlyMutated.has(duplicateId)).toBe(
      true,
    );
    expect(useCanvasUiStore.getState().recentlyMutated.has(originalId)).toBe(
      false,
    );

    /* ─── LLM final text references the duplicate id ─── */
    expect(result.finalText).toContain(duplicateId);
    expect(result.finalText).toContain("Foo V2");
  });

  it("LLM omits nodeId; F6 selection-default resolves to the duplicate", async () => {
    const { originalId, duplicateId } = setupDuplicateScenario();

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
                config: { text: "Foo V2" },
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: `✓ \`${duplicateId}.text\` (selecionado) agora é "Foo V2". O original ficou intacto.`,
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "muda esse texto pra Foo V2",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── Receipt resolved nodeId from selection ─── */
    const results = result.events.filter((e) => e.type === "tool_result");
    const payload = (results[0] as { result: unknown }).result as {
      ok: boolean;
      nodeId: string;
      selectionDefault?: boolean;
      after: { text: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.nodeId).toBe(duplicateId);
    expect(payload.selectionDefault).toBe(true);
    expect(payload.after.text).toBe("Foo V2");

    /* ─── Same store-level invariants as scenario 1 ─── */
    const ws = useWorkflowStore.getState();
    expect(
      (ws.nodes.find((n) => n.id === duplicateId)!.config as { text: string })
        .text,
    ).toBe("Foo V2");
    expect(
      (ws.nodes.find((n) => n.id === originalId)!.config as { text: string })
        .text,
    ).toBe("Foo");
  });

  it("F6 fails fast when nodeId is omitted and 0 nodes are selected", async () => {
    const ws = useWorkflowStore.getState();
    const id = ws.addNode("text", { x: 40, y: 40 }, { text: "Foo" });
    useWorkflowStore.setState({ selectedNodeIds: [] });

    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "update_node_config",
              arguments: JSON.stringify({ config: { text: "X" } }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "Não consigo identificar qual node mudar — me indica explicitamente.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "muda pra X",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    const results = result.events.filter((e) => e.type === "tool_result");
    const payload = (results[0] as { result: unknown }).result as {
      ok: boolean;
      error?: string;
    };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("ambiguous target");
    // Store should be unchanged.
    expect(
      (
        useWorkflowStore.getState().nodes.find((n) => n.id === id)!
          .config as { text: string }
      ).text,
    ).toBe("Foo");
  });

  it("F6 fails fast when nodeId is omitted and 2+ nodes are selected", async () => {
    const ws = useWorkflowStore.getState();
    const a = ws.addNode("text", { x: 0, y: 0 }, { text: "A" });
    const b = ws.addNode("text", { x: 100, y: 0 }, { text: "B" });
    useWorkflowStore.setState({ selectedNodeIds: [a, b] });

    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "update_node_config",
              arguments: JSON.stringify({ config: { text: "X" } }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "Quero saber qual dos dois nodes selecionados deve mudar.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "muda pra X",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    const results = result.events.filter((e) => e.type === "tool_result");
    const payload = (results[0] as { result: unknown }).result as {
      ok: boolean;
      error?: string;
      selectedNodeIds?: string[];
    };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("ambiguous target");
    expect(payload.selectedNodeIds).toEqual([a, b]);
  });
});
