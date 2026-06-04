import { beforeEach, describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";

/**
 * 2026-06-03 — Tier 1.5 graph chrome + repair tools.
 *
 * Three tools:
 *   - rename_node (set the user-facing label)
 *   - resize_node (persist user-set dimensions or clear)
 *   - repair_workflow (run the canonical graph-migration pipeline)
 *
 * The repair tool uses concrete drift cases (array.separator phantom,
 * fal-image fal-ai/ prefix) to verify the pipeline lands on the live
 * store and counters are non-zero only when work happened.
 */

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

/* ────────────────────────────────────────────────────────────────── */
/* rename_node                                                        */
/* ────────────────────────────────────────────────────────────────── */

describe("rename_node tool", () => {
  it("sets the label on an existing node + returns diff receipt", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("rename_node")!;
    const out = (await tool.execute(
      { nodeId: id, label: "System prompt" },
      {},
    )) as {
      ok: boolean;
      changed: string[];
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(["label"]);
    expect(out.before.label).toBe(null);
    expect(out.after.label).toBe("System prompt");
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    expect(node.label).toBe("System prompt");
  });

  it("clears the label when null is passed", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 });
    useWorkflowStore.getState().renameNode(id, "Old label");
    const tool = getTool("rename_node")!;
    const out = (await tool.execute(
      { nodeId: id, label: null },
      {},
    )) as {
      ok: boolean;
      changed: string[];
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(["label"]);
    expect(out.before.label).toBe("Old label");
    expect(out.after.label).toBe(null);
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    expect(node.label).toBeUndefined();
  });

  it("returns ok:false (no-op) when label already matches", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("text", { x: 0, y: 0 });
    useWorkflowStore.getState().renameNode(id, "Same");
    const tool = getTool("rename_node")!;
    const out = (await tool.execute(
      { nodeId: id, label: "Same" },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("no-op");
  });

  it("rejects when nodeId doesn't exist", async () => {
    const tool = getTool("rename_node")!;
    const out = (await tool.execute(
      { nodeId: "ghost", label: "x" },
      {},
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* resize_node                                                        */
/* ────────────────────────────────────────────────────────────────── */

describe("resize_node tool", () => {
  it("sets width + height + returns diff receipt", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("resize_node")!;
    const out = (await tool.execute(
      { nodeId: id, width: 320, height: 200 },
      {},
    )) as {
      ok: boolean;
      cleared: boolean;
      changed: string[];
      after: Record<string, unknown>;
    };
    expect(out.ok).toBe(true);
    expect(out.cleared).toBe(false);
    expect(out.changed.sort()).toEqual(["height", "width"]);
    expect(out.after.width).toBe(320);
    expect(out.after.height).toBe(200);
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    expect(node.size).toEqual({ width: 320, height: 200 });
  });

  it("clears the persisted size when clear=true + reports diff", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    useWorkflowStore.getState().resizeNode(id, { width: 320 });
    const tool = getTool("resize_node")!;
    const out = (await tool.execute(
      { nodeId: id, clear: true },
      {},
    )) as {
      ok: boolean;
      cleared: boolean;
      changed: string[];
      after: Record<string, unknown>;
    };
    expect(out.ok).toBe(true);
    expect(out.cleared).toBe(true);
    expect(out.changed).toEqual(["width"]);
    expect(out.after.width).toBe(null);
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    expect(node.size).toBeUndefined();
  });

  it("returns ok:false (no-op) when size already matches", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    useWorkflowStore.getState().resizeNode(id, { width: 320, height: 200 });
    const tool = getTool("resize_node")!;
    const out = (await tool.execute(
      { nodeId: id, width: 320, height: 200 },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("no-op");
  });

  it("rejects when nothing is provided (no width, height, or clear)", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("resize_node")!;
    await expect(tool.execute({ nodeId: id }, {})).rejects.toThrow();
  });

  it("rejects when nodeId doesn't exist", async () => {
    const tool = getTool("resize_node")!;
    const out = (await tool.execute(
      { nodeId: "ghost", width: 320 },
      {},
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toContain("ghost");
  });

  it("rejects negative dimensions via Zod", async () => {
    const id = useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("resize_node")!;
    await expect(
      tool.execute({ nodeId: id, width: -10 }, {}),
    ).rejects.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────── */
/* repair_workflow                                                    */
/* ────────────────────────────────────────────────────────────────── */

describe("repair_workflow tool", () => {
  it("returns changed:[] on a canonical graph (no-op)", async () => {
    useWorkflowStore.getState().addNode("text", { x: 0, y: 0 });
    const tool = getTool("repair_workflow")!;
    const out = (await tool.execute({}, {})) as {
      ok: boolean;
      changed: string[];
    };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual([]);
  });

  it("heals an array node with a phantom `separator` field", async () => {
    const id = useWorkflowStore
      .getState()
      .addNode("array", { x: 0, y: 0 }, { delimiter: "," });
    useWorkflowStore.setState((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              config: {
                ...(n.config as Record<string, unknown>),
                separator: "**",
              },
            }
          : n,
      ),
    }));
    const tool = getTool("repair_workflow")!;
    const out = (await tool.execute({}, {})) as {
      ok: boolean;
      changed: string[];
      bulk: { changedNodeCount: number };
    };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(["__bulk"]);
    expect(out.bulk.changedNodeCount).toBeGreaterThanOrEqual(1);
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    expect((node.config as Record<string, unknown>).separator).toBeUndefined();
    expect((node.config as { delimiter: string }).delimiter).toBe("**");
  });

  it("normalizes a fal-image model written with the legacy fal-ai/ prefix", async () => {
    const id = useWorkflowStore.getState().addNode("fal-image", {
      x: 0,
      y: 0,
    });
    useWorkflowStore.setState((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              config: {
                ...(n.config as Record<string, unknown>),
                model: "fal-ai/nano-banana-2",
              },
            }
          : n,
      ),
    }));
    const tool = getTool("repair_workflow")!;
    const out = (await tool.execute({}, {})) as {
      ok: boolean;
      changed: string[];
    };
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(["__bulk"]);
    const node = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === id)!;
    expect((node.config as { model: string }).model).toBe("nano-banana-2");
  });

  it("rejects unknown args (typo-proof contract)", async () => {
    const tool = getTool("repair_workflow")!;
    await expect(
      tool.execute({ unexpected: 1 }, {}),
    ).rejects.toThrow();
  });
});
