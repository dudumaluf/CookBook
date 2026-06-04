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

  it("spawns a node and returns the id + create receipt", async () => {
    const tool = getTool("add_node")!;
    const out = (await tool.execute(
      {
        kind: "text",
        position: { x: 50, y: 50 },
        config: { text: "hi" },
      },
      {},
    )) as {
      ok: boolean;
      nodeId: string;
      changed: string[];
      entity: { id: string; kind: string; config: Record<string, unknown> };
    };
    expect(out.ok).toBe(true);
    expect(typeof out.nodeId).toBe("string");
    expect(out.changed).toEqual(["__create"]);
    expect(out.entity.id).toBe(out.nodeId);
    expect(out.entity.kind).toBe("text");
    expect((out.entity.config as { text: string }).text).toBe("hi");
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

  it("creates an edge between two existing nodes + create receipt", async () => {
    const id1 = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    // ADR-0069 F15 — handle/type validation. Wiring text.out -> text.out
    // used to slip through the lax store check; now the LLM-side tool
    // catches the missing input handle. Switch the target to llm-text.user
    // (both sides text → text) so the edge actually validates.
    const id2 = useWorkflowStore.getState().addNode("llm-text", { x: 200, y: 0 });
    const tool = getTool("add_edge")!;
    const out = (await tool.execute(
      {
        source: id1,
        sourceHandle: "out",
        target: id2,
        targetHandle: "user",
      },
      {},
    )) as {
      ok: boolean;
      edgeId?: string;
      changed: string[];
      entity: { id: string; source: string; target: string };
    };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(["__create"]);
    expect(out.entity.source).toBe(id1);
    expect(out.entity.target).toBe(id2);
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
  });

  it("rejects unknown source handle with available list (F15)", async () => {
    const id1 = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const id2 = useWorkflowStore.getState().addNode("llm-text", { x: 200, y: 0 });
    const tool = getTool("add_edge")!;
    const out = (await tool.execute(
      {
        source: id1,
        sourceHandle: "fake-out",
        target: id2,
        targetHandle: "user",
      },
      {},
    )) as {
      ok: boolean;
      error?: string;
      availableOutputs?: Array<{ id: string }>;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("fake-out");
    expect(out.availableOutputs?.map((o) => o.id)).toContain("out");
  });

  it("rejects unknown target handle with available list (F15)", async () => {
    const id1 = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const id2 = useWorkflowStore.getState().addNode("llm-text", { x: 200, y: 0 });
    const tool = getTool("add_edge")!;
    const out = (await tool.execute(
      {
        source: id1,
        sourceHandle: "out",
        target: id2,
        targetHandle: "ghost",
      },
      {},
    )) as {
      ok: boolean;
      error?: string;
      availableInputs?: Array<{ id: string }>;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
    expect(out.availableInputs?.map((i) => i.id)).toEqual(
      expect.arrayContaining(["user", "system"]),
    );
  });

  it("rejects datatype mismatch with hint (F15)", async () => {
    const id1 = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const id2 = useWorkflowStore.getState().addNode("llm-text", { x: 200, y: 0 });
    const tool = getTool("add_edge")!;
    // text.out (text) -> llm-text.image-0 (image): incompatible.
    const out = (await tool.execute(
      {
        source: id1,
        sourceHandle: "out",
        target: id2,
        targetHandle: "image-0",
      },
      {},
    )) as {
      ok: boolean;
      error?: string;
      sourceType?: string;
      targetType?: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Type mismatch/i);
    expect(out.sourceType).toBe("text");
    expect(out.targetType).toBe("image");
  });
});

describe("update_node_config tool", () => {
  it("merges config patch into node + returns diff receipt", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "old" });
    const tool = getTool("update_node_config")!;
    const out = (await tool.execute(
      { nodeId: id, config: { text: "new" } },
      {},
    )) as {
      ok: boolean;
      changed: string[];
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(["text"]);
    expect(out.before.text).toBe("old");
    expect(out.after.text).toBe("new");
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    expect((node.config as { text: string }).text).toBe("new");
  });

  it("returns ok:false (no-op) when patch matches current value", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "same" });
    const tool = getTool("update_node_config")!;
    const out = (await tool.execute(
      { nodeId: id, config: { text: "same" } },
      {},
    )) as { ok: boolean; error?: string; attemptedPatch?: unknown };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("no-op");
    expect(out.attemptedPatch).toEqual({ text: "same" });
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
    )) as { ok: boolean; changed: string[]; after: Record<string, unknown> };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(["model"]);
    expect(out.after.model).toBe("flux-2-pro");
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === id)!;
    expect((node.config as { model: string }).model).toBe("flux-2-pro");
  });

  it("rejects array.separator with a hint pointing at delimiter", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("array", { x: 0, y: 0 }, { delimiter: ",", trim: true });
    const tool = getTool("update_node_config")!;
    const out = (await tool.execute(
      { nodeId: id, config: { separator: "**" } },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("array");
    expect(out.error).toContain("delimiter");
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === id)!;
    expect((node.config as { delimiter: string }).delimiter).toBe(",");
    expect("separator" in (node.config as object)).toBe(false);
  });

  it("accepts the real array.delimiter field", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("array", { x: 0, y: 0 }, { delimiter: ",", trim: true });
    const tool = getTool("update_node_config")!;
    const out = (await tool.execute(
      { nodeId: id, config: { delimiter: "**" } },
      {},
    )) as { ok: boolean; changed: string[]; after: Record<string, unknown> };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(["delimiter"]);
    expect(out.after.delimiter).toBe("**");
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === id)!;
    expect((node.config as { delimiter: string }).delimiter).toBe("**");
  });

  it("rejects phantom keys on `text` with the valid key list (F17)", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "hello" });
    const tool = getTool("update_node_config")!;
    const out = (await tool.execute(
      { nodeId: id, config: { fontSize: 18 } },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("text");
    expect(out.error).toContain("fontSize");
    expect(out.error).toMatch(/Valid keys/);
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === id)!;
    expect("fontSize" in (node.config as object)).toBe(false);
  });

  it("accepts the optional previewMode key on `text` (F17 allow-list)", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 }, { text: "hello" });
    const tool = getTool("update_node_config")!;
    const out = (await tool.execute(
      { nodeId: id, config: { previewMode: "names" } },
      {},
    )) as { ok: boolean; changed: string[]; after: Record<string, unknown> };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(["previewMode"]);
    expect(out.after.previewMode).toBe("names");
  });

  it("accepts optional llm-text fields not in defaultConfig (F17)", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("llm-text", { x: 0, y: 0 });
    const tool = getTool("update_node_config")!;
    const out = (await tool.execute(
      { nodeId: id, config: { temperature: 0.7, maxTokens: 256 } },
      {},
    )) as { ok: boolean; changed: string[]; after: Record<string, unknown> };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(expect.arrayContaining(["temperature", "maxTokens"]));
    expect(out.after.temperature).toBe(0.7);
    expect(out.after.maxTokens).toBe(256);
  });
});

describe("remove_node tool", () => {
  it("returns ok:false when id is missing (no-op, not idempotent)", async () => {
    const tool = getTool("remove_node")!;
    const out = (await tool.execute({ nodeId: "missing" }, {})) as {
      ok: boolean;
      error?: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("no-op");
  });

  it("removes existing node + cascade edges + returns delete receipt", async () => {
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
    const out = (await tool.execute({ nodeId: id1 }, {})) as {
      ok: boolean;
      changed: string[];
      entity: { id: string; kind: string };
      cascadedEdgeCount: number;
    };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(["__delete"]);
    expect(out.entity.id).toBe(id1);
    expect(out.entity.kind).toBe("text");
    expect(out.cascadedEdgeCount).toBe(1);
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useWorkflowStore.getState().edges).toHaveLength(0);
  });
});

describe("move_node tool", () => {
  it("updates node position + returns diff receipt", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("move_node")!;
    const out = (await tool.execute(
      { nodeId: id, position: { x: 100, y: 50 } },
      {},
    )) as {
      ok: boolean;
      changed: string[];
      after: Record<string, unknown>;
    };
    expect(out.ok).toBe(true);
    expect(out.changed.sort()).toEqual(["x", "y"]);
    expect(out.after.x).toBe(100);
    expect(out.after.y).toBe(50);
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    expect(node.position).toEqual({ x: 100, y: 50 });
  });

  it("returns ok:false (no-op) when position matches current", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("text", { x: 50, y: 50 });
    const tool = getTool("move_node")!;
    const out = (await tool.execute(
      { nodeId: id, position: { x: 50, y: 50 } },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("no-op");
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
    )) as {
      ok: boolean;
      selectedCount: number;
      selectedIds: string[];
      missingIds: string[];
    };
    expect(out.ok).toBe(true);
    expect(out.selectedCount).toBe(2);
    expect(out.selectedIds).toEqual([id1, id2]);
    expect(out.missingIds).toEqual([]);
    expect(useWorkflowStore.getState().selectedNodeIds).toEqual([id1, id2]);
  });

  it("filters out non-existent ids and reports them (F16)", async () => {
    const id1 = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("select_nodes")!;
    const out = (await tool.execute(
      { nodeIds: [id1, "ghost-1", "ghost-2", id1] },
      {},
    )) as {
      ok: boolean;
      selectedCount: number;
      selectedIds: string[];
      missingIds: string[];
      error?: string;
    };
    expect(out.ok).toBe(false);
    expect(out.selectedCount).toBe(1);
    expect(out.selectedIds).toEqual([id1]);
    expect(out.missingIds).toEqual(["ghost-1", "ghost-2"]);
    expect(out.error).toContain("ghost-1");
    expect(useWorkflowStore.getState().selectedNodeIds).toEqual([id1]);
  });
});

describe("remove_edge tool", () => {
  it("removes an existing edge by id + returns delete receipt", async () => {
    const id1 = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const id2 = useWorkflowStore.getState().addNode("text", { x: 200, y: 0 });
    useWorkflowStore.getState().addEdge({
      source: id1,
      sourceHandle: "out",
      target: id2,
      targetHandle: "out",
    });
    const edgeId = useWorkflowStore.getState().edges[0]!.id;
    const tool = getTool("remove_edge")!;
    const out = (await tool.execute({ edgeId }, {})) as {
      ok: boolean;
      changed: string[];
      entity: { id: string; source: string; target: string };
    };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(["__delete"]);
    expect(out.entity.id).toBe(edgeId);
    expect(out.entity.source).toBe(id1);
    expect(useWorkflowStore.getState().edges).toHaveLength(0);
  });

  it("returns ok:false when edgeId is missing (no-op)", async () => {
    const tool = getTool("remove_edge")!;
    const out = (await tool.execute(
      { edgeId: "edge-that-does-not-exist" },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("no-op");
  });

  it("rejects empty edgeId via Zod (catches unwrapped LLM args)", async () => {
    const tool = getTool("remove_edge")!;
    await expect(tool.execute({ edgeId: "" }, {})).rejects.toThrow();
  });
});
