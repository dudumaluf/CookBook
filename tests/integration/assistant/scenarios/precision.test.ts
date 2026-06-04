import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-06-04 — Scenarios bench, Theme 6: precision pass behaviors.
 *
 *  11. Compound ask + plan-first + auto-verify — user asks for 3
 *      distinct sub-tasks. LLM opens with `narrate({ Plan: ... })`,
 *      executes 3 structural writes, then calls
 *      `check_workflow_health` once before signing off (per the new
 *      VERIFICATION rule). The trace contains the plan note + every
 *      receipt + the health summary.
 *
 *  12. Error recovery (unknown kind) — user says "add an image-gen
 *      node". LLM tries `add_node({ kind: "image-gen", ... })`, gets
 *      `ok: false, error: "Unknown node kind 'image-gen'..."`,
 *      consults `read_node_schema({ kind: "fal-image" })` per the
 *      ERROR RECOVERY playbook, retries with the real kind. Final
 *      reply quotes the recovery, not a confabulated success.
 *
 *  13. Ambiguous "experimenta variações" → ask_user gate — LLM
 *      pauses with `ask_user` BEFORE any large-cost regenerate
 *      fires. Mirrors Scenario 10 but for the regenerate path
 *      (proves the gate works for every large-cost tool, not just
 *      run_workflow).
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

describe("Scenario 11 — compound ask follows plan-first protocol + auto-verifies", () => {
  it("LLM narrates plan, runs 3 structural writes, then check_workflow_health closes the turn", async () => {
    // Seed 3 nodes the user wants to mutate.
    const n1 = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "intro" });
    const n2 = useWorkflowStore
      .getState()
      .addNode("text", { x: 200, y: 0 }, { text: "outro" });
    const n3 = useWorkflowStore
      .getState()
      .addNode("text", { x: 400, y: 0 }, { text: "discardable" });

    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "plan",
            type: "function",
            function: {
              name: "narrate",
              arguments: JSON.stringify({
                message: `Plan: 1) rename_node ${n1} → "intro" 2) move_node ${n2} → (600, 0) 3) remove_node ${n3}`,
              }),
            },
          },
          {
            id: "rn",
            type: "function",
            function: {
              name: "rename_node",
              arguments: JSON.stringify({ nodeId: n1, label: "intro" }),
            },
          },
          {
            id: "mv",
            type: "function",
            function: {
              name: "move_node",
              arguments: JSON.stringify({
                nodeId: n2,
                position: { x: 600, y: 0 },
              }),
            },
          },
          {
            id: "rm",
            type: "function",
            function: {
              name: "remove_node",
              arguments: JSON.stringify({ nodeId: n3 }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "verify",
            type: "function",
            function: {
              name: "check_workflow_health",
              arguments: JSON.stringify({}),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: `✓ ${n1}.label='intro'. ✓ ${n2} em (600, 0). ✓ removi ${n3}. Health limpo.`,
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: `renomeia ${n1} pra "intro", move ${n2} pra (600, 0) e remove ${n3}`,
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── Plan narration came FIRST in the trace ─── */
    const narrations = result.events.filter((e) => e.type === "narration");
    const planNote = narrations.find((n) =>
      (n as { content: string }).content.startsWith("Plan: "),
    );
    expect(planNote).toBeDefined();
    expect((planNote as { content: string }).content).toContain("rename_node");
    expect((planNote as { content: string }).content).toContain("move_node");
    expect((planNote as { content: string }).content).toContain("remove_node");

    /* ─── 3 structural writes + 1 health check fired in order ─── */
    const calls = result.events.filter((e) => e.type === "tool_call");
    const callNames = calls.map((c) => (c as { toolName: string }).toolName);
    expect(callNames).toEqual([
      "narrate",
      "rename_node",
      "move_node",
      "remove_node",
      "check_workflow_health",
    ]);

    /* ─── Each write has its own structured receipt ─── */
    const results = result.events.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(5);
    const renameRes = (results[1] as { result: unknown }).result as {
      ok: boolean;
      changed: string[];
      after: { label: string };
    };
    expect(renameRes.ok).toBe(true);
    expect(renameRes.changed).toEqual(["label"]);
    expect(renameRes.after.label).toBe("intro");

    const moveRes = (results[2] as { result: unknown }).result as {
      ok: boolean;
      changed: string[];
      after: { x?: number; y?: number };
    };
    expect(moveRes.ok).toBe(true);
    expect(moveRes.after.x).toBe(600);

    const rmRes = (results[3] as { result: unknown }).result as {
      ok: boolean;
      changed: string[];
    };
    expect(rmRes.ok).toBe(true);
    expect(rmRes.changed).toEqual(["__delete"]);

    /* ─── Health check returned a clean summary ─── */
    const healthRes = (results[4] as { result: unknown }).result as {
      ok: boolean;
      issueCount: number;
      summary: string;
    };
    expect(healthRes.ok).toBe(true);
    expect(healthRes.issueCount).toBe(0);
    expect(healthRes.summary).toContain("0 issues");

    /* ─── Final state lines up with all three intents ─── */
    const stateNodes = useWorkflowStore.getState().nodes;
    const renamed = stateNodes.find((n) => n.id === n1);
    const moved = stateNodes.find((n) => n.id === n2);
    const removed = stateNodes.find((n) => n.id === n3);
    expect(renamed?.label).toBe("intro");
    expect(moved?.position.x).toBe(600);
    expect(removed).toBeUndefined();

    /* ─── LLM final reply cites the receipts AND the health line ─── */
    expect(result.finalText).toContain(n1);
    expect(result.finalText).toContain("(600, 0)");
    expect(result.finalText).toContain(n3);
    expect(result.finalText).toMatch(/health|limpo/i);
  });
});

describe("Scenario 12 — error recovery on unknown kind reconciles via read_node_schema", () => {
  it("add_node fails with 'Unknown node kind', LLM reads schema, retries with the right kind, succeeds", async () => {
    callOpenRouterMock
      // Turn 1: LLM tries the wrong kind (hallucination).
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "wrong",
            type: "function",
            function: {
              name: "add_node",
              arguments: JSON.stringify({
                kind: "image-gen",
                position: { x: 0, y: 0 },
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      // Turn 2: LLM reconciles via read_node_schema for the closest
      // real kind (per ERROR RECOVERY playbook).
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "schema",
            type: "function",
            function: {
              name: "read_node_schema",
              arguments: JSON.stringify({ kind: "fal-image" }),
            },
          },
        ],
        costUsd: 0.001,
      })
      // Turn 3: LLM retries with the right kind.
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "right",
            type: "function",
            function: {
              name: "add_node",
              arguments: JSON.stringify({
                kind: "fal-image",
                position: { x: 0, y: 0 },
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "✓ adicionei `fal-image` em (0, 0) — 'image-gen' não existe, usei o kind real.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "adiciona um image-gen node em (0, 0)",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── 3 tool calls fired in the recovery sequence ─── */
    const calls = result.events.filter((e) => e.type === "tool_call");
    const callNames = calls.map((c) => (c as { toolName: string }).toolName);
    expect(callNames).toEqual(["add_node", "read_node_schema", "add_node"]);

    /* ─── First add_node returned the unknown-kind error ─── */
    const results = result.events.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(3);
    const firstAdd = (results[0] as { result: unknown }).result as {
      ok: boolean;
      error?: string;
    };
    expect(firstAdd.ok).toBe(false);
    expect(firstAdd.error).toContain("Unknown node kind");
    expect(firstAdd.error).toContain("image-gen");

    /* ─── read_node_schema landed a real schema for fal-image ─── */
    const schemaRes = (results[1] as { result: unknown }).result as {
      found: boolean;
      kind?: string;
    };
    expect(schemaRes.found).toBe(true);
    expect(schemaRes.kind).toBe("fal-image");

    /* ─── Second add_node succeeded with a __create receipt ─── */
    const secondAdd = (results[2] as { result: unknown }).result as {
      ok: boolean;
      changed: string[];
      entity: { kind: string };
    };
    expect(secondAdd.ok).toBe(true);
    expect(secondAdd.changed).toEqual(["__create"]);
    expect(secondAdd.entity.kind).toBe("fal-image");

    /* ─── Final canvas has exactly one fal-image node ─── */
    const nodes = useWorkflowStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe("fal-image");

    /* ─── LLM final reply acknowledges the recovery (no confabulation) ─── */
    expect(result.finalText).toContain("fal-image");
    expect(result.finalText).toMatch(/n[a-z0-9]+|adicionei/);
  });
});

describe("Scenario 13 — ambiguous 'experimenta variações' triggers ask_user gate before regenerate", () => {
  it("LLM emits ask_user instead of regenerate; loop pauses; runId stays put", async () => {
    // Seed a node so regenerate isn't structurally invalid.
    useWorkflowStore
      .getState()
      .addNode("fal-image", { x: 0, y: 0 }, { prompt: "a sunset" });

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
                "Qual generation? Tenho várias na gallery. (latest / passa o id)",
              options: ["latest", "passa o id"],
            }),
          },
        },
      ],
      costUsd: 0.001,
    });

    const result = await runReasoner({
      userMessage: "experimenta variações dessa imagem",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── Loop paused before any regenerate fired ─── */
    expect(result.paused).toBe(true);
    const calls = result.events.filter((e) => e.type === "tool_call");
    expect(
      calls.some(
        (c) => (c as { toolName: string }).toolName === "regenerate",
      ),
    ).toBe(false);
    expect(
      calls.some((c) => (c as { toolName: string }).toolName === "ask_user"),
    ).toBe(true);

    /* ─── ask_user event surfaced for the UI ─── */
    const askEvents = result.events.filter((e) => e.type === "ask_user");
    expect(askEvents).toHaveLength(1);
    expect((askEvents[0] as { question: string }).question).toContain(
      "generation",
    );

    /* ─── runId untouched (no spend incurred) ─── */
    expect(useExecutionStore.getState().runId).toBe(beforeRunId);
  });
});
