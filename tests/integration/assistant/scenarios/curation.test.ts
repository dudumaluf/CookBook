import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-06-03 — Scenarios bench, Theme 4: library + gallery curation.
 *
 *   7. Group + add to group — user says "salva 3 imagens em um grupo
 *      Moodboard". LLM emits create_group with the 3 ids; the group
 *      lands in the asset store with the right name + members.
 *
 *   8. Pin generation — after compare_results, user says "fixa essa
 *      como vencedora". LLM calls pin_generation; the supabase
 *      generation repo's setPinned mock receives the right call.
 */

const { callOpenRouterMock, setPinnedMock } = vi.hoisted(() => ({
  callOpenRouterMock: vi.fn(),
  setPinnedMock: vi.fn().mockResolvedValue(undefined),
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
    setPinned: setPinnedMock,
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
  setPinnedMock.mockReset();
  setPinnedMock.mockResolvedValue(undefined);
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

describe("Scenario 7 — create_group bundles 3 images into 'Moodboard'", () => {
  it("LLM emits create_group with the 3 asset ids; the group lands in the asset store", async () => {
    // Seed 3 image assets (mimicking what `read_library` would expose).
    const a1 = useAssetStore.getState().createImageAssetFromUrl({
      url: "https://example.com/img1.jpg",
      name: "ref-1",
    });
    const a2 = useAssetStore.getState().createImageAssetFromUrl({
      url: "https://example.com/img2.jpg",
      name: "ref-2",
    });
    const a3 = useAssetStore.getState().createImageAssetFromUrl({
      url: "https://example.com/img3.jpg",
      name: "ref-3",
    });

    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "g1",
            type: "function",
            function: {
              name: "create_group",
              arguments: JSON.stringify({
                name: "Moodboard",
                assetIds: [a1, a2, a3],
                scope: "project",
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "Created group 'Moodboard' with 3 refs.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "salva 3 imagens em um grupo Moodboard",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── Tool result returns the new groupId ─── */
    const results = result.events.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(1);
    const r = (results[0] as { result: unknown }).result as {
      ok: boolean;
      groupId: string;
    };
    expect(r.ok).toBe(true);
    expect(typeof r.groupId).toBe("string");

    /* ─── Group landed in the store with the right name + members ─── */
    const groups = useAssetStore
      .getState()
      .assets.filter((a) => a.kind === "asset-group");
    expect(groups).toHaveLength(1);
    const group = groups[0] as {
      id: string;
      kind: "asset-group";
      name: string;
      assetIds: string[];
    };
    expect(group.name).toBe("Moodboard");
    expect(group.assetIds).toEqual([a1, a2, a3]);
    expect(group.id).toBe(r.groupId);
  });
});

describe("Scenario 8 — pin_generation marks the comparison winner", () => {
  it("LLM emits pin_generation; the generation repo receives setPinned(id, true)", async () => {
    callOpenRouterMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            id: "p1",
            type: "function",
            function: {
              name: "pin_generation",
              arguments: JSON.stringify({
                generationId: "gen-winner-42",
                pinned: true,
              }),
            },
          },
        ],
        costUsd: 0.001,
      })
      .mockResolvedValueOnce({
        text: "Pinned the winner.",
        costUsd: 0.001,
        finishReason: "stop",
      });

    const result = await runReasoner({
      userMessage: "fixa essa como vencedora",
      ownerId: "user-1",
      projectId: "p1",
      signal: new AbortController().signal,
    });

    /* ─── Repo received the right call ─── */
    expect(setPinnedMock).toHaveBeenCalledTimes(1);
    expect(setPinnedMock).toHaveBeenCalledWith("gen-winner-42", true);

    /* ─── Tool result mirrors the input back ─── */
    const results = result.events.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(1);
    const r = (results[0] as { result: unknown }).result as {
      ok: boolean;
      pinned: boolean;
    };
    expect(r.ok).toBe(true);
    expect(r.pinned).toBe(true);
  });
});
