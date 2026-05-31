import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

/**
 * `analyze_selection_subgraph` — Phase 2 tool that hands the reasoner
 * a structured snapshot + deterministic findings about a node selection.
 *
 * Each test pins one finding type to a small fixture so a regression
 * surfaces a behavioral change in the heuristic, not a "what changed?"
 * mystery in the wider suite.
 */

const recipeRepoMocks = {
  list: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
};
vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => recipeRepoMocks,
  SupabaseRecipeRepository: class {},
}));

const generationRepoMocks = {
  list: vi.fn().mockResolvedValue([]),
  insert: vi.fn(),
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

const { getTool } = await import("@/lib/assistant/tools");
const { useWorkflowStore } = await import("@/lib/stores/workflow-store");

interface AnalysisResult {
  ok: boolean;
  error?: string;
  message?: string;
  slice?: {
    nodes: { id: string; kind: string; configKeys: string[] }[];
    internalEdges: { id: string; source: string; target: string }[];
    boundaryIncoming: { id: string }[];
    boundaryOutgoing: { id: string }[];
    topologicalOrder: string[];
    kindCounts: Record<string, number>;
  };
  exposed?: {
    inputs: { internalNodeId: string; label: string }[];
    outputs: { internalNodeId: string; label: string }[];
  };
  findings?: {
    redundantTextChains: {
      consumer: string;
      handle: string;
      textNodeIds: string[];
      suggestion: string;
    }[];
    deadEndOutputs: { nodeId: string; handle: string }[];
    singleUseScaffolding: string[];
    exposableParams: {
      nodeId: string;
      configKey: string;
      control: string;
      currentValue: string;
    }[];
    estimatedRecipeSurface: { inputs: number; outputs: number; params: number };
  };
}

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

async function run(args: unknown = {}): Promise<AnalysisResult> {
  const tool = getTool("analyze_selection_subgraph");
  if (!tool) throw new Error("tool not registered");
  return (await tool.execute(args, {})) as AnalysisResult;
}

describe("analyze_selection_subgraph — registration", () => {
  it("is registered with the expected name + description", () => {
    const tool = getTool("analyze_selection_subgraph");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("analyze_selection_subgraph");
    expect(tool!.description.toLowerCase()).toContain("selection");
  });
});

describe("analyze_selection_subgraph — empty cases", () => {
  it("returns no_selection error when no ids supplied and selection empty", async () => {
    const result = await run({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_selection");
  });

  it("returns no_matching_nodes when explicit ids don't exist", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "real", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    const result = await run({ nodeIds: ["ghost-1", "ghost-2"] });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_matching_nodes");
  });
});

describe("analyze_selection_subgraph — slice shape", () => {
  it("returns config keys (not values) per node so the LLM can dig in via read_node_state", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: { text: "hi" } },
        { id: "b", kind: "text", position: { x: 0, y: 0 }, config: { text: "yo" } },
      ],
      edges: [],
      selectedNodeIds: ["a", "b"],
      selectedEdgeIds: [],
    });
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.slice!.nodes).toEqual([
      { id: "a", kind: "text", configKeys: ["text"] },
      { id: "b", kind: "text", configKeys: ["text"] },
    ]);
  });

  it("falls back to selectedNodeIds when nodeIds arg omitted", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "b", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: ["a", "b"],
      selectedEdgeIds: [],
    });
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.slice!.nodes).toHaveLength(2);
  });

  it("respects an explicit nodeIds arg over the canvas selection", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "b", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "c", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: ["a"], // canvas selection
      selectedEdgeIds: [],
    });
    const result = await run({ nodeIds: ["b", "c"] });
    expect(result.ok).toBe(true);
    expect(result.slice!.nodes.map((n) => n.id)).toEqual(["b", "c"]);
  });
});

describe("analyze_selection_subgraph — redundantTextChains", () => {
  it("flags two text nodes feeding the SAME llm-text user socket", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "t1", kind: "text", position: { x: 0, y: 0 }, config: { text: "Hello" } },
        { id: "t2", kind: "text", position: { x: 0, y: 0 }, config: { text: "World" } },
        {
          id: "llm",
          kind: "llm-text",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [
        { id: "e1", source: "t1", sourceHandle: "out", target: "llm", targetHandle: "user" },
        { id: "e2", source: "t2", sourceHandle: "out", target: "llm", targetHandle: "user" },
      ],
      selectedNodeIds: ["t1", "t2", "llm"],
      selectedEdgeIds: [],
    });
    const result = await run();
    expect(result.findings!.redundantTextChains).toHaveLength(1);
    const chain = result.findings!.redundantTextChains[0]!;
    expect(chain.consumer).toBe("llm");
    expect(chain.handle).toBe("user");
    expect(new Set(chain.textNodeIds)).toEqual(new Set(["t1", "t2"]));
    expect(chain.suggestion).toContain("text-concat");
  });

  it("does NOT flag a single text node feeding a socket", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "t1", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "llm", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "t1", sourceHandle: "out", target: "llm", targetHandle: "user" },
      ],
      selectedNodeIds: ["t1", "llm"],
      selectedEdgeIds: [],
    });
    const result = await run();
    expect(result.findings!.redundantTextChains).toHaveLength(0);
  });

  it("does NOT cross-flag llm-text outputs as redundant text chains", async () => {
    // Two LLM nodes feeding one socket is a feature, not a smell.
    useWorkflowStore.setState({
      nodes: [
        { id: "l1", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
        { id: "l2", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
        { id: "sink", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "l1", sourceHandle: "out", target: "sink", targetHandle: "user" },
        { id: "e2", source: "l2", sourceHandle: "out", target: "sink", targetHandle: "user" },
      ],
      selectedNodeIds: ["l1", "l2", "sink"],
      selectedEdgeIds: [],
    });
    const result = await run();
    expect(result.findings!.redundantTextChains).toHaveLength(0);
  });
});

describe("analyze_selection_subgraph — deadEndOutputs", () => {
  it("does NOT flag reactive (text/image/number) leaf outputs — they're free", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "t1", kind: "text", position: { x: 0, y: 0 }, config: {} },
        { id: "t2", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: ["t1", "t2"],
      selectedEdgeIds: [],
    });
    const result = await run();
    // Both text nodes have leaf outputs but text is reactive — no waste.
    expect(result.findings!.deadEndOutputs).toEqual([]);
  });
});

describe("analyze_selection_subgraph — singleUseScaffolding", () => {
  it("flags a sourceless scaffolding node with one downstream consumer", async () => {
    // A `text` with one populated config field, fanning out exactly once.
    useWorkflowStore.setState({
      nodes: [
        { id: "scaffold", kind: "text", position: { x: 0, y: 0 }, config: { text: "x" } },
        { id: "sink", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "scaffold", sourceHandle: "out", target: "sink", targetHandle: "user" },
      ],
      selectedNodeIds: ["scaffold", "sink"],
      selectedEdgeIds: [],
    });
    const result = await run();
    expect(result.findings!.singleUseScaffolding).toContain("scaffold");
    expect(result.findings!.singleUseScaffolding).not.toContain("sink");
  });

  it("does NOT flag a node feeding TWO consumers — fan-out is the point", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "t", kind: "text", position: { x: 0, y: 0 }, config: { text: "x" } },
        { id: "a", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
        { id: "b", kind: "llm-text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "t", sourceHandle: "out", target: "a", targetHandle: "user" },
        { id: "e2", source: "t", sourceHandle: "out", target: "b", targetHandle: "user" },
      ],
      selectedNodeIds: ["t", "a", "b"],
      selectedEdgeIds: [],
    });
    const result = await run();
    expect(result.findings!.singleUseScaffolding).not.toContain("t");
  });
});

describe("analyze_selection_subgraph — exposableParams + recipe surface", () => {
  it("flags configs that diverge from defaults on schemas with declared configParams", async () => {
    // Seedance declares configParams for aspectRatio. Its default
    // resolution is 720p (per the schema); changing aspectRatio away
    // from default makes it a recipe-param candidate.
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
        {
          id: "s1",
          kind: "seedance-video",
          position: { x: 0, y: 0 },
          // aspectRatio is among Seedance's declared configParams.
          config: { aspectRatio: "9:16" },
        },
      ],
      edges: [],
      selectedNodeIds: ["a", "s1"],
      selectedEdgeIds: [],
    });
    const result = await run();
    const params = result.findings!.exposableParams;
    const aspect = params.find(
      (p) => p.nodeId === "s1" && p.configKey === "aspectRatio",
    );
    expect(aspect).toBeDefined();
    expect(aspect!.control).toBe("select");
  });

  it("does NOT flag a default value as an exposable param", async () => {
    // Seedance's defaultConfig has resolution: "720p". A node carrying
    // exactly that value is matching the default and should NOT surface.
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
        {
          id: "s1",
          kind: "seedance-video",
          position: { x: 0, y: 0 },
          config: { resolution: "720p" },
        },
      ],
      edges: [],
      selectedNodeIds: ["a", "s1"],
      selectedEdgeIds: [],
    });
    const result = await run();
    const matched = result.findings!.exposableParams.some(
      (p) => p.nodeId === "s1" && p.configKey === "resolution",
    );
    expect(matched).toBe(false);
  });

  it("estimatedRecipeSurface counts inputs/outputs/params", async () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "t1", kind: "text", position: { x: 0, y: 0 }, config: { text: "p" } },
        { id: "t2", kind: "text", position: { x: 0, y: 0 }, config: { text: "q" } },
      ],
      edges: [],
      selectedNodeIds: ["t1", "t2"],
      selectedEdgeIds: [],
    });
    const result = await run();
    const s = result.findings!.estimatedRecipeSurface;
    // Text has no inputs (contenteditable, not a socket), so inputs = 0.
    expect(s.inputs).toBe(0);
    // Both text outputs are leaves → exposed outputs = 2.
    expect(s.outputs).toBe(2);
  });
});
