import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-06-03 — Scenarios bench, Theme 5: cost discipline.
 *
 *   9. Run-intent path — user says "renderiza"; LLM dispatches
 *      run_workflow directly. The reasoner emits a costClass: large
 *      narration before the dispatch (proves the UI hint fires) and
 *      the engine's runId increments (proves run actually started).
 *
 *  10. ask_user gate — LLM emits ask_user (the well-behaved path
 *      when there's no explicit run-intent). The loop pauses
 *      BEFORE any large-cost dispatch fires; runId stays put.
 *
 * The cost gate itself is enforced by the prompt rule (the LLM
 * decides to call ask_user vs. run_workflow). What we can verify
 * deterministically is that:
 *   - the narration carries the costClass label so the UI can show it,
 *   - ask_user pauses the loop cleanly with no side effects,
 *   - run_workflow actually starts the engine when it does fire.
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

describe("Scenario 9 — explicit run-intent dispatches run_workflow with a costClass: large narration", () => {
  it("emits a 'costClass: large' narration BEFORE run_workflow and bumps the engine runId", async () => {
    // Seed a non-empty canvas so run_workflow doesn't bail with "empty".
    useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "ok" });

    const beforeRunId = useExecutionStore.getState().runId;

    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "r1",
            type: "function",
            function: {
              name: "run_workflow",
              arguments: JSON.stringify({}),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "Run kicked off. Watch the Gallery.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "renderiza",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── Narration was emitted with the right cost class ─── */
    const narrations = result.events.filter((e) => e.type === "narration");
    expect(narrations.length).toBeGreaterThanOrEqual(1);
    const largeNarration = narrations.find((n) =>
      (n as { content: string }).content.includes("costClass: large"),
    );
    expect(largeNarration).toBeDefined();
    expect((largeNarration as { content: string }).content).toContain(
      "run_workflow",
    );

    /* ─── Narration came AFTER tool_call but BEFORE tool_result
     *      (the reasoner emits all tool_calls upfront, then for each
     *       call emits cost narration immediately before dispatch).
     */
    const events = result.events;
    const narrationIdx = events.findIndex(
      (e) =>
        e.type === "narration" &&
        (e as { content: string }).content.includes("run_workflow"),
    );
    const callIdx = events.findIndex(
      (e) =>
        e.type === "tool_call" &&
        (e as { toolName: string }).toolName === "run_workflow",
    );
    const resultIdx = events.findIndex(
      (e) =>
        e.type === "tool_result" &&
        (e as { toolName: string }).toolName === "run_workflow",
    );
    expect(callIdx).toBeGreaterThan(-1);
    expect(narrationIdx).toBeGreaterThan(-1);
    expect(resultIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeLessThan(narrationIdx);
    expect(narrationIdx).toBeLessThan(resultIdx);

    /* ─── Engine actually started (runId bumped) ─── */
    expect(useExecutionStore.getState().runId).toBe(beforeRunId + 1);
  });
});

describe("Scenario 10 — ask_user gate pauses the loop with no large-cost dispatch", () => {
  it("LLM emits ask_user first; runReasoner returns paused:true and the engine never starts", async () => {
    useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "ok" });

    const beforeRunId = useExecutionStore.getState().runId;

    callOpenRouterMock.mockResolvedValueOnce({
      text: "",
      toolCalls: [
        {
          id: "ask",
          type: "function",
          function: {
            name: "ask_user",
            arguments: JSON.stringify({
              question:
                "ok to spend ~$0.05 on run_workflow? It will hit Fal for image generation.",
              options: ["yes", "no"],
            }),
          },
        },
      ],
      costUsd: 0.001,
    });

    const result = await runReasoner({
      userMessage: "consegue testar?",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── Loop paused via ask_user sentinel ─── */
    expect(result.paused).toBe(true);

    /* ─── ask_user event surfaced for the UI ─── */
    const askEvents = result.events.filter((e) => e.type === "ask_user");
    expect(askEvents).toHaveLength(1);
    expect((askEvents[0] as { question: string }).question).toContain(
      "spend",
    );
    expect((askEvents[0] as { options: string[] }).options).toEqual([
      "yes",
      "no",
    ]);

    /* ─── No run_workflow tool call fired ─── */
    const calls = result.events.filter((e) => e.type === "tool_call");
    expect(
      calls.some(
        (c) => (c as { toolName: string }).toolName === "run_workflow",
      ),
    ).toBe(false);

    /* ─── Engine state untouched (no spend incurred) ─── */
    expect(useExecutionStore.getState().runId).toBe(beforeRunId);
    expect(useExecutionStore.getState().isRunning).toBe(false);

    /* The pendingQuestion store field is set by the prompt-bar UI
     * consumer (`onEvent` handler), not by `runReasoner` itself.
     * The reasoner's contract is just to emit the `ask_user` event
     * and pause — both verified above. */
  });
});
