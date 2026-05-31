import { beforeEach, describe, expect, it, vi } from "vitest";

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
    get: vi.fn(),
    insert: vi.fn(),
    setPinned: vi.fn(),
    setTitle: vi.fn(),
    setTags: vi.fn(),
    remove: vi.fn(),
    listForNode: vi.fn().mockResolvedValue([]),
  }),
  SupabaseGenerationRepository: class {},
}));

const { getTool } = await import("@/lib/assistant/tools");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

describe("propose_node_schema tool", () => {
  it("rejects when kind already exists in registry", async () => {
    const tool = getTool("propose_node_schema")!;
    const out = (await tool.execute(
      {
        kind: "text",
        title: "X",
        category: "input",
        description: "blah",
        inputs: [],
        outputs: [{ id: "out", label: "Out", dataType: "text" }],
        rationale: "user wants it",
      },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/already exists/i);
  });

  it("rejects invalid kind format", async () => {
    const tool = getTool("propose_node_schema")!;
    await expect(
      tool.execute(
        {
          kind: "BadKind",
          title: "X",
          category: "input",
          description: "x",
          inputs: [],
          outputs: [{ id: "out", label: "Out", dataType: "text" }],
          rationale: "y",
        },
        {},
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it("returns a structured proposal with id when accepted", async () => {
    const tool = getTool("propose_node_schema")!;
    const out = (await tool.execute(
      {
        kind: "flux-image-gen",
        title: "Flux Image",
        category: "ai-image",
        description: "Generate via Flux",
        inputs: [{ id: "prompt", label: "Prompt", dataType: "text" }],
        outputs: [{ id: "out", label: "Image", dataType: "image" }],
        defaultConfig: { model: "flux-dev" },
        rationale: "user explicitly asked for Flux",
      },
      {},
    )) as { ok: boolean; proposal?: { proposalId: string; kind: string } };
    expect(out.ok).toBe(true);
    expect(out.proposal?.kind).toBe("flux-image-gen");
    expect(out.proposal?.proposalId).toMatch(/^proposal:flux-image-gen-/);
  });
});

describe("detect_recipe_pattern tool", () => {
  it("returns empty list when canvas is empty", async () => {
    const tool = getTool("detect_recipe_pattern")!;
    const out = (await tool.execute({}, {})) as {
      patterns: Array<{ kindSequence: string }>;
    };
    expect(out.patterns).toEqual([]);
  });

  it("detects repeated chains", async () => {
    const ws = useWorkflowStore.getState();
    // Three identical chains: text → llm-text.
    const a1 = ws.addNode("text", { x: 0, y: 0 });
    const a2 = ws.addNode("llm-text", { x: 200, y: 0 });
    const b1 = ws.addNode("text", { x: 0, y: 200 });
    const b2 = ws.addNode("llm-text", { x: 200, y: 200 });
    ws.addEdge({
      source: a1,
      sourceHandle: "out",
      target: a2,
      targetHandle: "user-0",
    });
    ws.addEdge({
      source: b1,
      sourceHandle: "out",
      target: b2,
      targetHandle: "user-0",
    });
    const tool = getTool("detect_recipe_pattern")!;
    const out = (await tool.execute({}, {})) as {
      patterns: Array<{ kindSequence: string; count: number }>;
    };
    const target = out.patterns.find(
      (p) => p.kindSequence === "text → llm-text",
    );
    expect(target).toBeDefined();
    expect(target!.count).toBe(2);
  });

  it("filters by minOccurrences", async () => {
    const ws = useWorkflowStore.getState();
    const a1 = ws.addNode("text", { x: 0, y: 0 });
    const a2 = ws.addNode("llm-text", { x: 200, y: 0 });
    ws.addEdge({
      source: a1,
      sourceHandle: "out",
      target: a2,
      targetHandle: "user-0",
    });
    const tool = getTool("detect_recipe_pattern")!;
    const out = (await tool.execute({ minOccurrences: 3 }, {})) as {
      patterns: Array<{ count: number }>;
    };
    expect(out.patterns).toEqual([]);
  });
});
