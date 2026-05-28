import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: needed because importing `all-nodes` below transitively
// imports node-llm-text.tsx which imports callOpenRouter — the
// vi.mock factory runs before the test file's top-level
// `const callOpenRouterMock = vi.fn()` initializer would otherwise
// run, causing a TDZ ReferenceError.
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
    get: vi.fn(),
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
});

describe("runReasoner", () => {
  it("returns finalText when LLM has no tool calls", async () => {
    callOpenRouterMock.mockResolvedValue({
      text: "Nothing to do.",
      costUsd: 0.001,
      finishReason: "stop",
    });
    const result = await runReasoner({
      userMessage: "what?",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    expect(result.finalText).toBe("Nothing to do.");
    expect(result.events.some((e) => e.type === "assistant_text")).toBe(true);
    expect(result.totalCostUsd).toBeCloseTo(0.001, 4);
  });

  it("dispatches a tool call, threads result into next turn, then finishes", async () => {
    // Turn 1: LLM emits add_node tool call.
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "add_node",
              arguments: JSON.stringify({
                kind: "text",
                position: { x: 0, y: 0 },
                config: { text: "hi" },
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      // Turn 2: LLM sees result, finishes.
      .mockResolvedValueOnce({
        text: "Added the text node.",
        costUsd: 0.001,
        finishReason: "stop",
      });
    const result = await runReasoner({
      userMessage: "add a text node",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(result.finalText).toBe("Added the text node.");
    expect(
      result.events.filter((e) => e.type === "tool_call"),
    ).toHaveLength(1);
    expect(
      result.events.filter((e) => e.type === "tool_result"),
    ).toHaveLength(1);
  });

  it("emits narration events when LLM calls the narrate tool", async () => {
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "n-1",
            type: "function",
            function: {
              name: "narrate",
              arguments: JSON.stringify({ message: "checking gallery..." }),
            },
          },
        ],
        costUsd: 0,
      })
      .mockResolvedValueOnce({
        text: "Done.",
        costUsd: 0,
        finishReason: "stop",
      });
    const result = await runReasoner({
      userMessage: "do something",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    const narrations = result.events.filter((e) => e.type === "narration");
    expect(narrations).toHaveLength(1);
    expect((narrations[0] as { content: string }).content).toContain(
      "checking gallery",
    );
  });

  it("pauses when LLM calls ask_user", async () => {
    callOpenRouterMock.mockResolvedValueOnce({
      text: "",
      toolCalls: [
        {
          id: "q-1",
          type: "function",
          function: {
            name: "ask_user",
            arguments: JSON.stringify({
              question: "Which Soul ID?",
              options: ["Dudu", "Maria"],
            }),
          },
        },
      ],
      costUsd: 0,
    });
    const result = await runReasoner({
      userMessage: "make me a portrait",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    expect(result.paused).toBe(true);
    const askEvents = result.events.filter((e) => e.type === "ask_user");
    expect(askEvents).toHaveLength(1);
  });

  it("emits cap_hit when cost cap is breached", async () => {
    callOpenRouterMock.mockResolvedValueOnce({
      text: "",
      toolCalls: [
        {
          id: "c-1",
          type: "function",
          function: {
            name: "narrate",
            arguments: JSON.stringify({ message: "spendy" }),
          },
        },
      ],
      costUsd: 1.0,
    });
    const result = await runReasoner({
      userMessage: "do",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });
    expect(result.cappedAt).toBe("cost");
    expect(result.events.some((e) => e.type === "cap_hit")).toBe(true);
  });

  it("returns aborted when signal triggers", async () => {
    const controller = new AbortController();
    controller.abort();
    callOpenRouterMock.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const result = await runReasoner({
      userMessage: "do",
      ownerId: "user-1",
      projectId: "p1",
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
  });
});
