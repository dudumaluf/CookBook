import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-06-03 — Scenarios bench, Theme 3: hygiene & pre-flight.
 *
 *   5. Repair drift — graph has a fal-image node with the legacy
 *      `fal-ai/<id>` model string. User says "tá quebrado, conserta",
 *      LLM calls `repair_workflow`, bulk receipt reports
 *      `changedNodeCount: 1`, store ends with the canonical id.
 *
 *   6. Pre-flight chip — graph has an llm-text node missing its
 *      required `user` input. LLM updates an unrelated node's
 *      config; the tool result carries `__preflightHealth` with
 *      the unwired_required_input issue (proving the assistant
 *      sees broken state on the next turn).
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

describe("Scenario 5 — repair_workflow heals fal-ai/ drift with a bulk receipt", () => {
  it("a node carrying legacy fal-ai/flux-2-pro is normalized to flux-2-pro and reported in bulk", async () => {
    // Seed a graph with the same shape that v6 saves used to ship:
    // a fal-image node whose `model` accidentally carries the
    // endpoint id rather than the literal.
    useWorkflowStore.setState({
      nodes: [
        {
          id: "fal-1",
          kind: "fal-image",
          position: { x: 0, y: 0 },
          config: { model: "fal-ai/flux-2-pro", prompt: "a sunset" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });

    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "r1",
            type: "function",
            function: {
              name: "repair_workflow",
              arguments: JSON.stringify({}),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "Repaired 1 fal-image model.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "tá quebrado, conserta",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── Bulk receipt with counters ─── */
    const results = result.events.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(1);
    const r = (results[0] as { result: unknown }).result as {
      ok: boolean;
      changed: string[];
      bulk: {
        changedNodeCount: number;
        changedEdgeCount: number;
        droppedEdgeCount: number;
      };
    };
    expect(r.ok).toBe(true);
    expect(r.changed).toEqual(["__bulk"]);
    expect(r.bulk.changedNodeCount).toBe(1);
    expect(r.bulk.changedEdgeCount).toBe(0);
    expect(r.bulk.droppedEdgeCount).toBe(0);

    /* ─── Store actually healed ─── */
    const fal = useWorkflowStore.getState().nodes.find((n) => n.id === "fal-1")!;
    expect((fal.config as { model: string }).model).toBe("flux-2-pro");
  });
});

describe("Scenario 6 — __preflightHealth surfaces broken state on the next turn", () => {
  it("a write tool against a graph with unwired llm-text user attaches __preflightHealth to the result", async () => {
    // Seed a graph: text node + llm-text node, NO edge between them
    // → llm-text's required `user` input is unwired, an error-severity
    // health issue.
    const textId = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "hello" });
    const llmId = useWorkflowStore
      .getState()
      .addNode("llm-text", { x: 300, y: 0 });

    // The LLM patches the text node's text (a structural mutation that
    // triggers the pre-flight scan even though the issue is on a
    // *different* node).
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "u1",
            type: "function",
            function: {
              name: "update_node_config",
              arguments: JSON.stringify({
                nodeId: textId,
                config: { text: "world" },
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: `Patched. But heads-up: ${llmId} has no \`user\` input wired.`,
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "muda o texto pro 'world'",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    const results = result.events.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(1);
    const r = (results[0] as { result: unknown }).result as {
      ok: boolean;
      changed: string[];
      __preflightHealth?: {
        note: string;
        issues: Array<{
          severity: "error" | "warning";
          code: string;
          nodeId?: string;
        }>;
      };
    };

    /* ─── The patch itself succeeded with a valid receipt ─── */
    expect(r.ok).toBe(true);
    expect(r.changed).toEqual(["text"]);

    /* ─── __preflightHealth piggy-backs on the receipt ─── */
    expect(r.__preflightHealth).toBeDefined();
    expect(r.__preflightHealth?.issues.length).toBeGreaterThanOrEqual(1);
    const unwired = r.__preflightHealth?.issues.find(
      (i) => i.code === "unwired_required_input",
    );
    expect(unwired).toBeDefined();
    expect(unwired?.severity).toBe("error");
    expect(unwired?.nodeId).toBe(llmId);

    /* ─── LLM final text references the broken state (not confabulated) ─── */
    expect(result.finalText).toContain(llmId);
    expect(result.finalText).toMatch(/user|wired/i);
  });
});
