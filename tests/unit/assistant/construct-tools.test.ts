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

describe("add_node tool", () => {
  it("rejects unknown kinds", async () => {
    const tool = getTool("add_node")!;
    const out = (await tool.execute(
      { kind: "totally-fake", position: { x: 0, y: 0 } },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Unknown node kind");
  });

  it("spawns a node and returns the id", async () => {
    const tool = getTool("add_node")!;
    const out = (await tool.execute(
      {
        kind: "text",
        position: { x: 50, y: 50 },
        config: { text: "hi" },
      },
      {},
    )) as { ok: boolean; nodeId: string };
    expect(out.ok).toBe(true);
    expect(typeof out.nodeId).toBe("string");
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
  });
});

describe("add_edge tool", () => {
  it("rejects when source/target missing", async () => {
    const tool = getTool("add_edge")!;
    const out = (await tool.execute(
      {
        source: "nope",
        sourceHandle: "out",
        target: "nope2",
        targetHandle: "in",
      },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
  });

  it("creates an edge between two existing nodes", async () => {
    const id1 = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const id2 = useWorkflowStore.getState().addNode("text", { x: 200, y: 0 });
    const tool = getTool("add_edge")!;
    const out = (await tool.execute(
      {
        source: id1,
        sourceHandle: "out",
        target: id2,
        targetHandle: "out",
      },
      {},
    )) as { ok: boolean; edgeId?: string };
    expect(out.ok).toBe(true);
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
  });
});

describe("update_node_config tool", () => {
  it("merges config patch into node", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "old" });
    const tool = getTool("update_node_config")!;
    const out = (await tool.execute(
      { nodeId: id, config: { text: "new" } },
      {},
    )) as { ok: boolean };
    expect(out.ok).toBe(true);
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    expect((node.config as { text: string }).text).toBe("new");
  });

  it("rejects an unknown fal-image model with a useful error", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("fal-image", { x: 0, y: 0 }, { model: "nano-banana-2" });
    const tool = getTool("update_node_config")!;
    const out = (await tool.execute(
      { nodeId: id, config: { model: "fal-ai/nano-banana-2" } },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("fal-image");
    expect(out.error).toContain("nano-banana-2");
    // State unchanged — bad value didn't slip through.
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === id)!;
    expect((node.config as { model: string }).model).toBe("nano-banana-2");
  });

  it("accepts a valid fal-image model swap", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("fal-image", { x: 0, y: 0 }, { model: "nano-banana-2" });
    const tool = getTool("update_node_config")!;
    const out = (await tool.execute(
      { nodeId: id, config: { model: "flux-2-pro" } },
      {},
    )) as { ok: boolean };
    expect(out.ok).toBe(true);
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === id)!;
    expect((node.config as { model: string }).model).toBe("flux-2-pro");
  });
});

describe("remove_node tool", () => {
  it("idempotent — missing id is a no-op", async () => {
    const tool = getTool("remove_node")!;
    const out = (await tool.execute({ nodeId: "missing" }, {})) as {
      ok: boolean;
    };
    expect(out.ok).toBe(true);
  });

  it("removes existing node + cascade edges", async () => {
    const id1 = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const id2 = useWorkflowStore.getState().addNode("text", { x: 100, y: 0 });
    useWorkflowStore.getState().addEdge({
      source: id1,
      sourceHandle: "out",
      target: id2,
      targetHandle: "out",
    });
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
    const tool = getTool("remove_node")!;
    await tool.execute({ nodeId: id1 }, {});
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useWorkflowStore.getState().edges).toHaveLength(0);
  });
});

describe("move_node tool", () => {
  it("updates node position", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("move_node")!;
    await tool.execute({ nodeId: id, position: { x: 100, y: 50 } }, {});
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    expect(node.position).toEqual({ x: 100, y: 50 });
  });
});

describe("select_nodes tool", () => {
  it("replaces the selection", async () => {
    const id1 = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const id2 = useWorkflowStore.getState().addNode("text", { x: 100, y: 0 });
    const tool = getTool("select_nodes")!;
    const out = (await tool.execute(
      { nodeIds: [id1, id2] },
      {},
    )) as { ok: boolean; selectedCount: number };
    expect(out.selectedCount).toBe(2);
    expect(useWorkflowStore.getState().selectedNodeIds).toEqual([id1, id2]);
  });
});
