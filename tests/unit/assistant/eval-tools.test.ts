import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

const { callOpenRouterMock } = vi.hoisted(() => ({
  callOpenRouterMock: vi.fn(),
}));
vi.mock("@/lib/llm/call-openrouter", () => ({
  callOpenRouter: callOpenRouterMock,
  LlmCallError: class extends Error {},
}));

const generationRepoMocks = {
  insert: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  get: vi.fn(),
  setPinned: vi.fn(),
  setTitle: vi.fn(),
  setTags: vi.fn(),
  remove: vi.fn(),
  listForNode: vi.fn().mockResolvedValue([]),
};
vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => generationRepoMocks,
  SupabaseGenerationRepository: class {},
}));

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  }),
  SupabaseRecipeRepository: class {},
}));

const { getTool } = await import("@/lib/assistant/tools");
const { useExecutionStore } = await import("@/lib/stores/execution-store");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  callOpenRouterMock.mockReset();
  Object.values(generationRepoMocks).forEach((m) => {
    if (typeof m.mockReset === "function") m.mockReset();
  });
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
  useExecutionStore.setState({
    runId: 0,
    isRunning: false,
    records: new Map(),
  });
});

describe("evaluate_result tool", () => {
  it("rejects when neither generationId nor imageUrl is provided", async () => {
    const tool = getTool("evaluate_result")!;
    await expect(
      tool.execute({ criteria: "good photo" }, {}),
    ).rejects.toBeInstanceOf(Error);
  });

  it("returns ok:false when generation isn't an image", async () => {
    generationRepoMocks.get.mockResolvedValue({
      id: "g1",
      output: { type: "text", data: "blah" },
    });
    const tool = getTool("evaluate_result")!;
    const out = (await tool.execute(
      { generationId: "g1", criteria: "x" },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not an image/i);
  });

  it("returns parsed eval JSON when LLM responds correctly", async () => {
    generationRepoMocks.get.mockResolvedValue({
      id: "g1",
      output: { type: "image", data: "https://x.test/a.png" },
    });
    callOpenRouterMock.mockResolvedValue({
      text: JSON.stringify({
        score: 0.8,
        strengths: ["sharp focus"],
        weaknesses: ["soft shadows"],
        reasoning: "matches the criteria",
      }),
      costUsd: 0.001,
    });
    const tool = getTool("evaluate_result")!;
    const out = (await tool.execute(
      { generationId: "g1", criteria: "sharp portrait" },
      { signal: new AbortController().signal },
    )) as {
      ok: boolean;
      score?: number;
      strengths?: string[];
      reasoning?: string;
    };
    expect(out.ok).toBe(true);
    expect(out.score).toBe(0.8);
    expect(out.reasoning).toBe("matches the criteria");
  });

  it("returns ok:false when LLM emits invalid JSON", async () => {
    callOpenRouterMock.mockResolvedValue({ text: "not json", costUsd: 0 });
    const tool = getTool("evaluate_result")!;
    const out = (await tool.execute(
      { imageUrl: "https://x.test/a.png", criteria: "foo" },
      { signal: new AbortController().signal },
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/invalid JSON/i);
  });
});

describe("compare_results tool", () => {
  it("rejects when fewer than 2 ids provided (Zod min)", async () => {
    const tool = getTool("compare_results")!;
    await expect(
      tool.execute({ generationIds: ["g1"], criteria: "x" }, {}),
    ).rejects.toBeInstanceOf(Error);
  });

  it("returns ranking enriched with generation ids", async () => {
    generationRepoMocks.get.mockImplementation(async (id: string) => ({
      id,
      output: { type: "image", data: `https://x.test/${id}.png` },
    }));
    callOpenRouterMock.mockResolvedValue({
      text: JSON.stringify({
        ranking: [
          { index: 2, rank: 1, score: 0.9, notes: "best comp" },
          { index: 1, rank: 2, score: 0.7, notes: "softer" },
        ],
        summary: "image 2 wins",
      }),
      costUsd: 0.002,
    });
    const tool = getTool("compare_results")!;
    const out = (await tool.execute(
      { generationIds: ["g1", "g2"], criteria: "moody portrait" },
      { signal: new AbortController().signal },
    )) as {
      ok: boolean;
      ranking?: { generationId: string; rank: number }[];
      summary?: string;
    };
    expect(out.ok).toBe(true);
    expect(out.ranking?.[0]).toMatchObject({
      rank: 1,
      generationId: "g2",
    });
    expect(out.summary).toBe("image 2 wins");
  });
});

describe("regenerate tool", () => {
  it("returns ok:false when generation missing", async () => {
    generationRepoMocks.get.mockResolvedValue(null);
    const tool = getTool("regenerate")!;
    const out = (await tool.execute(
      { generationId: "missing" },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
  });

  it("returns ok:false when source node no longer on canvas", async () => {
    generationRepoMocks.get.mockResolvedValue({
      id: "g1",
      nodeId: "deleted-node",
    });
    const tool = getTool("regenerate")!;
    const out = (await tool.execute({ generationId: "g1" }, {})) as {
      ok: boolean;
      error?: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no longer exists/i);
  });

  it("patches config and triggers run_from when source node present", async () => {
    const id = useWorkflowStore.getState().addNode(
      "text",
      { x: 0, y: 0 },
      { text: "old" },
    );
    generationRepoMocks.get.mockResolvedValue({
      id: "g1",
      nodeId: id,
      nodeKind: "text",
    });
    const startSpy = vi.spyOn(
      useExecutionStore.getState(),
      "startRunFrom",
    );
    startSpy.mockImplementation(async () => undefined);
    const tool = getTool("regenerate")!;
    const out = (await tool.execute(
      { generationId: "g1", configPatch: { text: "new" } },
      {},
    )) as { ok: boolean; nodeId?: string };
    expect(out.ok).toBe(true);
    expect(out.nodeId).toBe(id);
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    expect((node.config as { text: string }).text).toBe("new");
    expect(startSpy).toHaveBeenCalledWith(id);
  });
});
