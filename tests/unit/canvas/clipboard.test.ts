import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetClipboardForTests,
  copySelectedNodes,
  duplicateSelectedNodes,
  getClipboardBuffer,
  pasteFromClipboard,
  tryHandleClipboardKey,
  type ClipboardState,
} from "@/lib/canvas/clipboard";
import {
  __resetSpawnPositionGetterForTests,
  setSpawnPositionGetter,
} from "@/lib/canvas/spawn-position";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * Build a fake `ClipboardState` backed by mutable arrays + spies. The same
 * shape `useWorkflowStore.getState()` exposes — mutations on `addNode`,
 * `addEdge` etc. push into the local arrays, and tests then assert against
 * those arrays plus the spies' call records.
 */
function makeFakeStore(opts: {
  nodes?: NodeInstance[];
  edges?: WorkflowEdge[];
  selectedNodeIds?: string[];
} = {}) {
  const nodes: NodeInstance[] = [...(opts.nodes ?? [])];
  const edges: WorkflowEdge[] = [...(opts.edges ?? [])];
  let selectedNodeIds: string[] = [...(opts.selectedNodeIds ?? [])];
  let nextNodeId = 100;
  let nextEdgeId = 100;

  const addNode = vi.fn(
    (
      kind: string,
      position: { x: number; y: number },
      initialConfig?: Record<string, unknown>,
    ) => {
      const id = `n${nextNodeId++}`;
      nodes.push({
        id,
        kind,
        position,
        config: initialConfig ?? {},
      });
      return id;
    },
  );
  const addEdge = vi.fn(
    (edge: Omit<WorkflowEdge, "id">) => {
      const id = `e${nextEdgeId++}`;
      edges.push({ id, ...edge });
      return id;
    },
  );
  const renameNode = vi.fn((id: string, label: string | undefined) => {
    const n = nodes.find((x) => x.id === id);
    if (n) n.label = label;
  });
  const resizeNode = vi.fn(
    (id: string, size: { width?: number; height?: number } | undefined) => {
      const n = nodes.find((x) => x.id === id);
      if (n) n.size = size;
    },
  );
  const setSelectedNodeIds = vi.fn((ids: string[]) => {
    selectedNodeIds = [...ids];
  });

  // Re-read on every getter so the latest array contents surface to the
  // clipboard implementation (otherwise paste would see the pre-paste node
  // list when the store mutates mid-call).
  const state: ClipboardState = {
    get nodes() {
      return nodes;
    },
    get edges() {
      return edges;
    },
    get selectedNodeIds() {
      return selectedNodeIds;
    },
    addNode,
    addEdge,
    renameNode,
    resizeNode,
    setSelectedNodeIds,
  };

  return {
    state,
    nodes,
    edges,
    getSelectedNodeIds: () => selectedNodeIds,
    addNode,
    addEdge,
    renameNode,
    resizeNode,
    setSelectedNodeIds,
  };
}

function makeNode(
  id: string,
  overrides: Partial<NodeInstance> = {},
): NodeInstance {
  return {
    id,
    kind: "fal-image",
    position: { x: 100, y: 200 },
    config: { foo: "bar" },
    ...overrides,
  };
}

afterEach(() => {
  __resetClipboardForTests();
  __resetSpawnPositionGetterForTests();
  vi.restoreAllMocks();
});

describe("copySelectedNodes", () => {
  it("returns null and writes nothing when nothing is selected", () => {
    const f = makeFakeStore({
      nodes: [makeNode("a"), makeNode("b")],
      selectedNodeIds: [],
    });
    const payload = copySelectedNodes(f.state);
    expect(payload).toBeNull();
    expect(getClipboardBuffer()).toBeNull();
  });

  it("snapshots the selected nodes' kind + position + config", () => {
    const f = makeFakeStore({
      nodes: [
        makeNode("a", { kind: "k1", position: { x: 1, y: 2 }, config: { z: 9 } }),
        makeNode("b", { kind: "k2", position: { x: 3, y: 4 }, config: { z: 8 } }),
      ],
      selectedNodeIds: ["a"],
    });
    const payload = copySelectedNodes(f.state);
    expect(payload?.nodes).toHaveLength(1);
    expect(payload?.nodes[0]).toEqual({
      id: "a",
      kind: "k1",
      position: { x: 1, y: 2 },
      config: { z: 9 },
    });
  });

  it("includes label and size only when present on the source node", () => {
    const f = makeFakeStore({
      nodes: [
        makeNode("a", { label: "Subject", size: { width: 320 } }),
        makeNode("b"),
      ],
      selectedNodeIds: ["a", "b"],
    });
    const payload = copySelectedNodes(f.state);
    expect(payload?.nodes[0].label).toBe("Subject");
    expect(payload?.nodes[0].size).toEqual({ width: 320 });
    expect(payload?.nodes[1].label).toBeUndefined();
    expect(payload?.nodes[1].size).toBeUndefined();
  });

  it("includes only edges fully internal to the selection", () => {
    const f = makeFakeStore({
      nodes: [makeNode("a"), makeNode("b"), makeNode("c")],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" },
        { id: "e2", source: "b", sourceHandle: "out", target: "c", targetHandle: "in" },
        { id: "e3", source: "a", sourceHandle: "out", target: "c", targetHandle: "in" },
      ],
      selectedNodeIds: ["a", "b"],
    });
    const payload = copySelectedNodes(f.state);
    expect(payload?.edges).toHaveLength(1);
    expect(payload?.edges[0]).toEqual({
      source: "a",
      sourceHandle: "out",
      target: "b",
      targetHandle: "in",
    });
  });

  it("deep-clones config so post-copy mutations don't leak into the buffer", () => {
    const config: Record<string, unknown> = { items: ["one"] };
    const f = makeFakeStore({
      nodes: [makeNode("a", { config })],
      selectedNodeIds: ["a"],
    });
    copySelectedNodes(f.state);
    (config.items as string[]).push("two");
    const buffered = getClipboardBuffer();
    const items = (buffered?.nodes[0].config as { items: string[] }).items;
    expect(items).toEqual(["one"]);
  });
});

describe("pasteFromClipboard", () => {
  it("is a no-op when the buffer is empty", () => {
    const f = makeFakeStore();
    const result = pasteFromClipboard(f.state);
    expect(result.newNodeIds).toEqual([]);
    expect(f.addNode).not.toHaveBeenCalled();
  });

  it("re-instantiates nodes with fresh ids and centres them on the spawn anchor", () => {
    setSpawnPositionGetter(() => ({ x: 1000, y: 500 }));
    const f = makeFakeStore({
      nodes: [
        makeNode("a", { position: { x: 0, y: 0 } }),
        makeNode("b", { position: { x: 100, y: 100 } }),
      ],
      selectedNodeIds: ["a", "b"],
    });
    copySelectedNodes(f.state);
    const result = pasteFromClipboard(f.state);
    expect(result.newNodeIds).toHaveLength(2);
    // Centroid of (0,0) + (100,100) = (50,50). Anchor (1000,500) → translation (+950, +450).
    // Pasted nodes should be at (950, 450) and (1050, 550).
    const newA = f.nodes.find((n) => n.id === result.newNodeIds[0]);
    const newB = f.nodes.find((n) => n.id === result.newNodeIds[1]);
    expect(newA?.position).toEqual({ x: 950, y: 450 });
    expect(newB?.position).toEqual({ x: 1050, y: 550 });
  });

  it("re-anchors internal edges to the new node ids", () => {
    setSpawnPositionGetter(() => ({ x: 0, y: 0 }));
    const f = makeFakeStore({
      nodes: [
        makeNode("a", { position: { x: 0, y: 0 } }),
        makeNode("b", { position: { x: 100, y: 0 } }),
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" },
      ],
      selectedNodeIds: ["a", "b"],
    });
    copySelectedNodes(f.state);
    const result = pasteFromClipboard(f.state);
    expect(result.newEdgeIds).toHaveLength(1);
    const newEdge = f.edges.find((e) => e.id === result.newEdgeIds[0]);
    expect(newEdge?.source).toBe(result.newNodeIds[0]);
    expect(newEdge?.target).toBe(result.newNodeIds[1]);
  });

  it("replaces the workflow selection with the freshly-pasted node ids", () => {
    setSpawnPositionGetter(() => ({ x: 0, y: 0 }));
    const f = makeFakeStore({
      nodes: [makeNode("a"), makeNode("b")],
      selectedNodeIds: ["a", "b"],
    });
    copySelectedNodes(f.state);
    const result = pasteFromClipboard(f.state);
    expect(f.setSelectedNodeIds).toHaveBeenCalledWith(result.newNodeIds);
  });

  it("forwards label and size to the new node when they were captured", () => {
    setSpawnPositionGetter(() => ({ x: 0, y: 0 }));
    const f = makeFakeStore({
      nodes: [makeNode("a", { label: "Cool node", size: { width: 480 } })],
      selectedNodeIds: ["a"],
    });
    copySelectedNodes(f.state);
    const result = pasteFromClipboard(f.state);
    const newId = result.newNodeIds[0];
    expect(f.renameNode).toHaveBeenCalledWith(newId, "Cool node");
    expect(f.resizeNode).toHaveBeenCalledWith(newId, { width: 480 });
  });

  it("respects the explicit `center` option over the registered getter", () => {
    setSpawnPositionGetter(() => ({ x: 9999, y: 9999 }));
    const f = makeFakeStore({
      nodes: [makeNode("a", { position: { x: 0, y: 0 } })],
      selectedNodeIds: ["a"],
    });
    copySelectedNodes(f.state);
    const result = pasteFromClipboard(f.state, {
      center: { x: 50, y: 50 },
    });
    const newA = f.nodes.find((n) => n.id === result.newNodeIds[0]);
    expect(newA?.position).toEqual({ x: 50, y: 50 });
  });

  it("respects an explicit pasteOffset over the centroid math", () => {
    setSpawnPositionGetter(() => ({ x: 9999, y: 9999 }));
    const f = makeFakeStore({
      nodes: [makeNode("a", { position: { x: 100, y: 100 } })],
      selectedNodeIds: ["a"],
    });
    copySelectedNodes(f.state);
    const result = pasteFromClipboard(f.state, {
      pasteOffset: { dx: 30, dy: 30 },
    });
    const newA = f.nodes.find((n) => n.id === result.newNodeIds[0]);
    expect(newA?.position).toEqual({ x: 130, y: 130 });
  });

  it("drops edges whose endpoints fell out of the snapshot (defensive)", () => {
    setSpawnPositionGetter(() => ({ x: 0, y: 0 }));
    const f = makeFakeStore();
    // Forge a payload with a dangling edge (only `a` is in `nodes`).
    const result = pasteFromClipboard(f.state, {
      payload: {
        version: 1,
        nodes: [
          {
            id: "a",
            kind: "fal-image",
            position: { x: 0, y: 0 },
            config: {},
          },
        ],
        edges: [
          {
            source: "a",
            sourceHandle: "out",
            target: "missing",
            targetHandle: "in",
          },
        ],
      },
    });
    expect(result.newEdgeIds).toEqual([]);
    expect(f.addEdge).not.toHaveBeenCalled();
  });
});

describe("duplicateSelectedNodes", () => {
  it("places the duplicate at +30 / +30 from the original (no viewport math)", () => {
    setSpawnPositionGetter(() => ({ x: 9999, y: 9999 }));
    const f = makeFakeStore({
      nodes: [makeNode("a", { position: { x: 100, y: 100 } })],
      selectedNodeIds: ["a"],
    });
    const result = duplicateSelectedNodes(f.state);
    const newA = f.nodes.find((n) => n.id === result.newNodeIds[0]);
    expect(newA?.position).toEqual({ x: 130, y: 130 });
  });

  it("returns empty when nothing is selected", () => {
    const f = makeFakeStore({ selectedNodeIds: [] });
    const result = duplicateSelectedNodes(f.state);
    expect(result.newNodeIds).toEqual([]);
  });
});

/* ──────────────────── Keyboard dispatch ──────────────────── */

function makeKeyEvent(opts: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean };
}): KeyboardEvent {
  // Hand-rolled stand-in (mirrors `delete-key-handler.test.ts`'s pattern):
  // we don't want to mount happy-dom for a pure dispatch test and we want
  // to inject `target` directly.
  const preventDefault = vi.fn();
  return {
    key: opts.key,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    target: opts.target ?? null,
    preventDefault,
  } as unknown as KeyboardEvent;
}

describe("tryHandleClipboardKey", () => {
  it("ignores plain letter keys without the cmd/ctrl modifier", () => {
    const f = makeFakeStore({
      nodes: [makeNode("a")],
      selectedNodeIds: ["a"],
    });
    const handled = tryHandleClipboardKey(makeKeyEvent({ key: "c" }), () =>
      f.state,
    );
    expect(handled).toBe(false);
    expect(getClipboardBuffer()).toBeNull();
  });

  it("ignores cmd+C with shift held (lets DevTools etc. take it)", () => {
    const f = makeFakeStore({
      nodes: [makeNode("a")],
      selectedNodeIds: ["a"],
    });
    const handled = tryHandleClipboardKey(
      makeKeyEvent({ key: "c", metaKey: true, shiftKey: true }),
      () => f.state,
    );
    expect(handled).toBe(false);
    expect(getClipboardBuffer()).toBeNull();
  });

  it.each([["INPUT"], ["TEXTAREA"], ["SELECT"]])(
    "ignores cmd+C when target is <%s> (so plain text copy works)",
    (tagName) => {
      const f = makeFakeStore({
        nodes: [makeNode("a")],
        selectedNodeIds: ["a"],
      });
      const handled = tryHandleClipboardKey(
        makeKeyEvent({
          key: "c",
          metaKey: true,
          target: { tagName },
        }),
        () => f.state,
      );
      expect(handled).toBe(false);
      expect(getClipboardBuffer()).toBeNull();
    },
  );

  it("ignores cmd+C when target is contentEditable", () => {
    const f = makeFakeStore({
      nodes: [makeNode("a")],
      selectedNodeIds: ["a"],
    });
    const handled = tryHandleClipboardKey(
      makeKeyEvent({
        key: "c",
        metaKey: true,
        target: { tagName: "DIV", isContentEditable: true },
      }),
      () => f.state,
    );
    expect(handled).toBe(false);
    expect(getClipboardBuffer()).toBeNull();
  });

  it("cmd+C copies the current selection to the buffer", () => {
    const f = makeFakeStore({
      nodes: [makeNode("a"), makeNode("b")],
      selectedNodeIds: ["a"],
    });
    const event = makeKeyEvent({ key: "c", metaKey: true });
    const handled = tryHandleClipboardKey(event, () => f.state);
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    const buffered = getClipboardBuffer();
    expect(buffered?.nodes).toHaveLength(1);
    expect(buffered?.nodes[0].id).toBe("a");
  });

  it("ctrl+C also works (Linux / Windows)", () => {
    const f = makeFakeStore({
      nodes: [makeNode("a")],
      selectedNodeIds: ["a"],
    });
    const handled = tryHandleClipboardKey(
      makeKeyEvent({ key: "c", ctrlKey: true }),
      () => f.state,
    );
    expect(handled).toBe(true);
  });

  it("cmd+V is a no-op when the buffer is empty", () => {
    const f = makeFakeStore({ selectedNodeIds: [] });
    const event = makeKeyEvent({ key: "v", metaKey: true });
    const handled = tryHandleClipboardKey(event, () => f.state);
    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(f.addNode).not.toHaveBeenCalled();
  });

  it("cmd+V pastes the buffered payload", () => {
    setSpawnPositionGetter(() => ({ x: 0, y: 0 }));
    const f = makeFakeStore({
      nodes: [makeNode("a")],
      selectedNodeIds: ["a"],
    });
    copySelectedNodes(f.state);
    const event = makeKeyEvent({ key: "v", metaKey: true });
    const handled = tryHandleClipboardKey(event, () => f.state);
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(f.addNode).toHaveBeenCalledTimes(1);
  });

  it("cmd+D duplicates the current selection in place (+30 offset)", () => {
    const f = makeFakeStore({
      nodes: [makeNode("a", { position: { x: 100, y: 100 } })],
      selectedNodeIds: ["a"],
    });
    const event = makeKeyEvent({ key: "d", metaKey: true });
    const handled = tryHandleClipboardKey(event, () => f.state);
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(f.nodes).toHaveLength(2);
    const newNode = f.nodes[1];
    expect(newNode.position).toEqual({ x: 130, y: 130 });
  });

  it("upper-case 'V' is treated the same as 'v'", () => {
    setSpawnPositionGetter(() => ({ x: 0, y: 0 }));
    const f = makeFakeStore({
      nodes: [makeNode("a")],
      selectedNodeIds: ["a"],
    });
    copySelectedNodes(f.state);
    const handled = tryHandleClipboardKey(
      makeKeyEvent({ key: "V", metaKey: true }),
      () => f.state,
    );
    expect(handled).toBe(true);
    expect(f.addNode).toHaveBeenCalledTimes(1);
  });
});
