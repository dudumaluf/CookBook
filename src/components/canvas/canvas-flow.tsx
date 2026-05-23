"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge as RfEdge,
  type EdgeChange,
  type Node as RfNode,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import "@/lib/engine/all-nodes";
import { nodeRegistry } from "@/lib/engine/registry";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import {
  ASSET_DRAG_MIME,
  parseAssetDrag,
} from "@/lib/library/asset-drag";
import { assetToNode } from "@/lib/library/asset-to-node";
import { dispatchAssetDrop } from "@/lib/library/dispatch-asset-drop";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

import { BaseNode } from "@/components/nodes/base-node";

/* ────────────────────────────────────────────────────────────────────────── */
/* Keyboard handler — exported for unit testing                               */
/* ────────────────────────────────────────────────────────────────────────── */

interface DeleteKeyTarget {
  selectedNodeIds: readonly string[];
  selectedEdgeIds: readonly string[];
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
}

/**
 * Returns `true` iff the event was a delete-shortcut that we acted on (so
 * the caller should `preventDefault`). Pure / DOM-event-only — no React, no
 * store imports — to make this trivial to unit-test.
 *
 * Editable elements (input / textarea / select / `contentEditable`) are
 * excluded so typing in the prompt bar or a node body's textarea doesn't
 * accidentally wipe selected nodes/edges.
 *
 * Both selection sets are processed: a user can shift-click a node and an
 * edge together, then Backspace once to drop them both. Order doesn't
 * matter for correctness because `removeNode` already cascades into edges,
 * and `removeEdge` is idempotent (no-op when the id is already gone).
 */
export function tryHandleDeleteKey(
  event: KeyboardEvent,
  getState: () => DeleteKeyTarget,
): boolean {
  if (event.key !== "Backspace" && event.key !== "Delete") return false;
  const target = event.target as HTMLElement | null;
  if (target) {
    const tag = target.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target.isContentEditable
    ) {
      return false;
    }
  }
  const { selectedNodeIds, selectedEdgeIds, removeNode, removeEdge } =
    getState();
  if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) {
    return false;
  }
  for (const id of selectedNodeIds) removeNode(id);
  for (const id of selectedEdgeIds) removeEdge(id);
  return true;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* React Flow ↔ workflow-store bridge                                         */
/* ────────────────────────────────────────────────────────────────────────── */

type FlowNodeData = {
  kind: string;
  config: unknown;
  label?: string;
  /**
   * Per-instance user-resized dimensions (ADR-0028), mirrored from
   * `NodeInstance.size`. Forwarded to BaseNode as `size.width / height`
   * via GenericNode below. Always optional — content-driven nodes pass
   * `undefined` and BaseNode falls back to the schema's `default*`.
   */
  size?: { width?: number; height?: number };
};

type FlowNode = RfNode<FlowNodeData>;

/**
 * Generic React Flow node component that delegates rendering to the schema's
 * Body. Registered once in `nodeTypes` under the wildcard kind `"cookbook"`.
 *
 * We could create a separate React Flow type per kind (Text, Image, …) but
 * one generic wrapper that reads the schema from the registry is dramatically
 * simpler and avoids keeping React Flow's nodeTypes map in sync.
 */
function GenericNode({ id, data, selected }: NodeProps<FlowNode>) {
  const schema = nodeRegistry.get(data.kind);
  const updateConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const renameNode = useWorkflowStore((s) => s.renameNode);

  if (!schema) {
    return (
      <div className="rounded-md border border-destructive bg-card px-3 py-2 text-xs text-destructive">
        Unknown node kind: {data.kind}
      </div>
    );
  }

  const Body = schema.Body;
  // Wire the schema-declared settings into BaseNode's standardized `⋯`
  // trigger (ADR-0027). When a schema doesn't declare settings, the slot
  // is omitted entirely so the header still reads `[icon · title · status]`
  // — no empty button slot taking up width.
  const SettingsContent = schema.settings?.Content;
  const settingsSlot = SettingsContent
    ? {
        content: (
          <SettingsContent
            nodeId={id}
            config={data.config}
            updateConfig={(partial) => updateConfig(id, partial)}
            selected={Boolean(selected)}
          />
        ),
        hasOverrides:
          schema.settings?.hasOverrides?.(data.config) ?? false,
        ariaLabel: `${schema.title} settings`,
      }
    : undefined;

  // Compose the size slot (ADR-0028). Per-instance user resize wins; falls
  // back to the schema's `default*`; min / max + resizable come straight
  // from the schema. When the schema declares neither size nor user-resized
  // dims, the slot stays `undefined` and BaseNode uses its legacy chrome.
  const schemaSize = schema.size;
  const instanceSize = data.size;
  const sizeSlot =
    schemaSize || instanceSize
      ? {
          width: instanceSize?.width ?? schemaSize?.defaultWidth,
          height: instanceSize?.height ?? schemaSize?.defaultHeight,
          minWidth: schemaSize?.minWidth,
          maxWidth: schemaSize?.maxWidth,
          minHeight: schemaSize?.minHeight,
          maxHeight: schemaSize?.maxHeight,
          resizable: schemaSize?.resizable,
        }
      : undefined;

  return (
    <BaseNode
      nodeId={id}
      schema={schema}
      selected={Boolean(selected)}
      label={data.label}
      onRename={(label) => renameNode(id, label)}
      settings={settingsSlot}
      size={sizeSlot}
    >
      <Body
        nodeId={id}
        config={data.config}
        updateConfig={(partial) => updateConfig(id, partial)}
        selected={Boolean(selected)}
      />
    </BaseNode>
  );
}

const NODE_TYPES: NodeTypes = {
  cookbook: GenericNode,
};

/**
 * Theme toggle rendered as a React Flow ControlButton so it adopts the same
 * dark pill styling as zoom + fit. Keeps the canvas chrome unified instead of
 * floating yet another separate pill.
 */
function ThemeControlButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Hydration boundary: server doesn't know the theme; once mounted we render
    // the correct icon.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === "dark";
  const label = mounted
    ? `Switch to ${isDark ? "light" : "dark"} theme`
    : "Toggle theme";

  return (
    <ControlButton
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={label}
      aria-label={label}
    >
      {mounted ? (
        isDark ? (
          <Sun />
        ) : (
          <Moon />
        )
      ) : (
        <Sun style={{ opacity: 0 }} aria-hidden />
      )}
    </ControlButton>
  );
}

function toFlowNode(n: NodeInstance, selectedIds: Set<string>): FlowNode {
  return {
    id: n.id,
    type: "cookbook",
    position: n.position,
    // Selection has to be explicit — we're in React Flow's controlled mode
    // (parent owns `nodes`), so RF only knows what we tell it. Without this,
    // RF's internal `deleteKeyCode` handler sees an empty selection set
    // and Backspace/Delete silently no-op.
    selected: selectedIds.has(n.id),
    data: {
      kind: n.kind,
      config: n.config,
      label: n.label,
      size: n.size,
    },
  };
}

function toFlowEdge(e: WorkflowEdge, selectedIds: Set<string>): RfEdge {
  const isSelected = selectedIds.has(e.id);
  return {
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    animated: false,
    // Same controlled-mode trick we use for nodes: React Flow's internal
    // store derives from props, so we must mark selection explicitly or
    // RF's own select highlight + our keyboard delete path get out of sync.
    selected: isSelected,
    // Selected edges get a visible highlight (accent color + thicker). The
    // default style still applies for unselected edges via `defaultEdgeOptions`.
    style: isSelected
      ? { stroke: "var(--accent)", strokeWidth: 2.5 }
      : undefined,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* CanvasFlow                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Public wrapper. Wraps the inner component in a `ReactFlowProvider` so
 * `useReactFlow` (needed for screen-to-flow coordinate conversion on drop) is
 * available without depending on `ReactFlow` mount timing.
 */
export function CanvasFlow() {
  return (
    <ReactFlowProvider>
      <CanvasFlowInner />
    </ReactFlowProvider>
  );
}

/**
 * React Flow canvas wired to the workflow store. The store is the source of
 * truth; React Flow's internal state is derived from it via memos.
 *
 * Change handlers translate React Flow events back to store mutations. We
 * only act on changes the store cares about (position, removal, selection,
 * new connections).
 *
 * Drag-from-Library lands here too: `onDragOver` claims the drag iff the
 * payload carries our custom MIME, and `onDrop` resolves the asset and asks
 * the workflow store to spawn the corresponding node at the drop position.
 */
function CanvasFlowInner() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const selectedNodeIds = useWorkflowStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useWorkflowStore((s) => s.selectedEdgeIds);
  const moveNode = useWorkflowStore((s) => s.moveNode);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const removeEdge = useWorkflowStore((s) => s.removeEdge);
  const addEdge = useWorkflowStore((s) => s.addEdge);
  const resizeNode = useWorkflowStore((s) => s.resizeNode);
  const setSelectedNodeIds = useWorkflowStore((s) => s.setSelectedNodeIds);
  const setSelectedEdgeIds = useWorkflowStore((s) => s.setSelectedEdgeIds);
  const { screenToFlowPosition } = useReactFlow();

  const selectedNodeIdSet = useMemo(
    () => new Set(selectedNodeIds),
    [selectedNodeIds],
  );
  const selectedEdgeIdSet = useMemo(
    () => new Set(selectedEdgeIds),
    [selectedEdgeIds],
  );
  const rfNodes = useMemo(
    () => nodes.map((n) => toFlowNode(n, selectedNodeIdSet)),
    [nodes, selectedNodeIdSet],
  );
  const rfEdges = useMemo(
    () => edges.map((e) => toFlowEdge(e, selectedEdgeIdSet)),
    [edges, selectedEdgeIdSet],
  );

  // Debounce position writes — React Flow fires many position changes per
  // drag; we coalesce them with a microtask flush.
  const pendingMoves = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );

  const flushMoves = useCallback(() => {
    for (const [id, pos] of pendingMoves.current.entries()) {
      moveNode(id, pos);
    }
    pendingMoves.current.clear();
  }, [moveNode]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Apply select changes incrementally on top of the current selection.
      //
      // React Flow can emit changes in three flavours we care about:
      //   - single-click on a node → batch of [{false: oldA}, {false: oldB},
      //     {true: new}] (clears prior, sets new)
      //   - shift/cmd-click → just [{true: new}] (additive)
      //   - click on empty canvas → [{false: each-current}] (clears all)
      //
      // The previous implementation only picked up `selected: true` changes
      // and overwrote the whole set, which broke shift-click multi-select
      // AND empty-canvas deselect (the deselect-only batch was filtered out,
      // leaving stale selection in the store + a no-longer-visible "selected"
      // node that Backspace would silently remove later).
      const selectionChanges = changes.filter((c) => c.type === "select");
      let nextSelection: string[] | null = null;
      if (selectionChanges.length > 0) {
        const next = new Set(selectedNodeIds);
        for (const c of selectionChanges) {
          if (c.selected) next.add(c.id);
          else next.delete(c.id);
        }
        nextSelection = Array.from(next);
      }

      for (const c of changes) {
        if (c.type === "position" && c.position) {
          pendingMoves.current.set(c.id, c.position);
        } else if (c.type === "remove") {
          removeNode(c.id);
        } else if (
          c.type === "dimensions" &&
          // `setAttributes` is React Flow's signal for "this is a real
          // user-driven resize, persist it" (vs the passive measurement
          // change that fires on every content reflow). Truthy values:
          // `true` for both axes, `"width"` / `"height"` for axis-locked
          // NodeResizeControls.
          c.setAttributes &&
          c.dimensions
        ) {
          // Only persist the axis (or axes) the user actually dragged.
          // `setAttributes === true` → both; `"width"` → width-only; etc.
          // Anything else gets passed through with both dims so the lib's
          // own bounds clamping is respected.
          const next: { width?: number; height?: number } = {};
          if (c.setAttributes === true || c.setAttributes === "width") {
            next.width = c.dimensions.width;
          }
          if (c.setAttributes === true || c.setAttributes === "height") {
            next.height = c.dimensions.height;
          }
          resizeNode(c.id, next);
        }
      }
      if (pendingMoves.current.size > 0) {
        queueMicrotask(flushMoves);
      }
      if (nextSelection) {
        setSelectedNodeIds(nextSelection);
      }
    },
    [removeNode, resizeNode, flushMoves, setSelectedNodeIds, selectedNodeIds],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // Same incremental-merge pattern as nodes (see onNodesChange comment).
      // RF emits select changes in three flavours depending on click context;
      // we walk the batch and add/remove ids one at a time so shift-click
      // multi-select and empty-canvas deselect both work.
      const selectionChanges = changes.filter((c) => c.type === "select");
      let nextSelection: string[] | null = null;
      if (selectionChanges.length > 0) {
        const next = new Set(selectedEdgeIds);
        for (const c of selectionChanges) {
          if (c.selected) next.add(c.id);
          else next.delete(c.id);
        }
        nextSelection = Array.from(next);
      }
      for (const c of changes) {
        if (c.type === "remove") removeEdge(c.id);
      }
      if (nextSelection) setSelectedEdgeIds(nextSelection);
    },
    [removeEdge, setSelectedEdgeIds, selectedEdgeIds],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      addEdge({
        source: conn.source,
        sourceHandle: conn.sourceHandle ?? "out",
        target: conn.target,
        targetHandle: conn.targetHandle ?? "in",
      });
    },
    [addEdge],
  );

  // Make sure React Flow re-measures when the canvas mounts.
  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, []);

  // Backspace / Delete → delete selected node(s) AND edge(s).
  //
  // We deliberately implement this ourselves instead of relying on React
  // Flow's built-in `deleteKeyCode` for two reasons:
  //   1. RF reads selection from its INTERNAL store, which is derived from
  //      our `nodes` / `edges` props. There's a one-render lag between the
  //      user clicking and RF's internal store knowing, which makes
  //      "click + immediately press Delete" flaky.
  //   2. Our workflow store is already the single source of truth — letting
  //      the keyboard path go through the store's `removeNode` / `removeEdge`
  //      directly keeps everything consistent and trivially testable.
  //
  // Input-aware: ignored when focus is inside an editable element so typing
  // Backspace in the prompt bar / a text node / the rename input doesn't
  // wipe the canvas.
  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (
        tryHandleDeleteKey(event, () => {
          const s = useWorkflowStore.getState();
          return {
            selectedNodeIds: s.selectedNodeIds,
            selectedEdgeIds: s.selectedEdgeIds,
            removeNode: s.removeNode,
            removeEdge: s.removeEdge,
          };
        })
      ) {
        event.preventDefault();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Shift+drag = always selection box, regardless of where it starts.
  //
  // Why: React Flow's default lets a node "claim" a shift+mousedown event
  // (it's still a click on the node), so dragging from inside a node turns
  // into a node-move instead of a selection box. Users reasonably expect
  // shift+drag to always select. We toggle `nodesDraggable` off while Shift
  // is held so the drag falls through to RF's selection mode regardless of
  // direction (the L→R / R→L difference was just whether the initial pixel
  // happened to land on a node).
  //
  // Plain (un-shifted) drag on a node still moves the node — only the
  // shift modifier disables dragging. window blur clears the flag so an
  // alt-tab while holding Shift doesn't strand the canvas in undraggable
  // mode.
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    function syncFromKey(e: KeyboardEvent) {
      setShiftHeld(e.shiftKey);
    }
    function clear() {
      setShiftHeld(false);
    }
    document.addEventListener("keydown", syncFromKey);
    document.addEventListener("keyup", syncFromKey);
    window.addEventListener("blur", clear);
    return () => {
      document.removeEventListener("keydown", syncFromKey);
      document.removeEventListener("keyup", syncFromKey);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Library asset drag — accept iff our custom MIME is present; ignore
  // foreign drags (OS files, other apps' URLs) so they fall through to the
  // browser's default behaviour.
  const onDragOver = useCallback((event: React.DragEvent) => {
    if (event.dataTransfer.types.includes(ASSET_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const raw = event.dataTransfer.getData(ASSET_DRAG_MIME);
      if (!raw) return;
      event.preventDefault();

      const payload = parseAssetDrag(raw);
      if (!payload) return;

      // Hit-test: did the drop land on an existing React Flow node?
      // RF renders every node as `.react-flow__node[data-id="…"]` so a
      // `closest()` walk from the actual DOM target picks the deepest
      // node ancestor (handles drops on the body / header / handles).
      let dropNodeId: string | undefined;
      let dropNodeKind: string | undefined;
      let dropIteratorGroupId: string | undefined;
      const targetEl = event.target as HTMLElement | null;
      const nodeEl = targetEl?.closest?.(
        ".react-flow__node",
      ) as HTMLElement | null;
      const wsState = useWorkflowStore.getState();
      if (nodeEl) {
        const id = nodeEl.getAttribute("data-id") ?? undefined;
        if (id) {
          dropNodeId = id;
          const targetNode = wsState.nodes.find((n) => n.id === id);
          dropNodeKind = targetNode?.kind;
          if (targetNode?.kind === "image-iterator") {
            // Resolve the iterator's linked group so the dispatcher
            // can pick `append-to-group` (Slice 5.6, ADR-0032).
            const cfg = (targetNode.config ?? {}) as { groupId?: unknown };
            if (typeof cfg.groupId === "string") {
              dropIteratorGroupId = cfg.groupId;
            }
          }
        }
      }

      const actions = dispatchAssetDrop({
        payload,
        target:
          dropNodeId && dropNodeKind
            ? {
                nodeId: dropNodeId,
                nodeKind: dropNodeKind,
                iteratorGroupId: dropIteratorGroupId,
              }
            : undefined,
      });

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const ws = useWorkflowStore.getState();
      const assetStore = useAssetStore.getState();

      // Each action is small and idempotent; we run them in order.
      // Multi-soul-id drops produce N spawn-node actions; we offset
      // each subsequent spawn by a small delta so they don't stack
      // exactly on top of each other.
      let spawnIndex = 0;
      for (const action of actions) {
        if (action.type === "spawn-node") {
          // For image / soul-id spawns coming from a 1-asset payload we
          // round-trip through assetToNode so the node lands with the
          // canonical { url } / { customReferenceId, … } config the
          // legacy spawn produced. For image-iterator spawns we trust
          // the dispatcher's initialConfig — it already carries the
          // groupId.
          let initialConfig = action.initialConfig;
          if (
            (action.kind === "image" || action.kind === "soul-id") &&
            typeof initialConfig.assetId === "string"
          ) {
            const asset = assetStore.getAsset(initialConfig.assetId);
            if (asset) initialConfig = assetToNode(asset).initialConfig;
          }
          ws.addNode(
            action.kind,
            {
              x: position.x + spawnIndex * 24,
              y: position.y + spawnIndex * 24,
            },
            initialConfig,
          );
          spawnIndex++;
        } else if (action.type === "create-group-and-spawn-iterator") {
          // 5.6d: N images dropped on empty canvas → create an
          // `Untitled` group on the fly + spawn an iterator linked to
          // it. The asset-store's createGroup handles auto-naming
          // (`Untitled <N>`).
          const newGroupId = useAssetStore.getState().createGroup({
            assetIds: action.assetIds,
            isUntitled: action.isUntitled,
            scope: "project",
          });
          ws.addNode(
            "image-iterator",
            {
              x: position.x + spawnIndex * 24,
              y: position.y + spawnIndex * 24,
            },
            { groupId: newGroupId, cursor: 0, selectionMode: "all" },
          );
          spawnIndex++;
        } else if (action.type === "append-to-group") {
          // Propagate the dropped ids into the iterator's linked
          // group. Two cases: a raw image-id list, or a single
          // sentinel "@group:<id>" that needs expansion.
          const expandedIds: string[] = [];
          for (const id of action.assetIds) {
            if (typeof id === "string" && id.startsWith("@group:")) {
              const sourceGroupId = id.slice("@group:".length);
              const sourceGroup = assetStore.getAsset(sourceGroupId);
              if (sourceGroup?.kind === "asset-group") {
                expandedIds.push(...sourceGroup.assetIds);
              }
            } else {
              expandedIds.push(id);
            }
          }
          if (expandedIds.length > 0) {
            useAssetStore
              .getState()
              .addToGroup(action.groupId, expandedIds);
          }
        }
        // "noop" → fall through; nothing to do.
      }

      // Drag landed → user committed; clear the library selection so
      // the next click starts fresh (matches Finder).
      useAssetStore.getState().clearAssetSelection();
    },
    [screenToFlowPosition],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDragOver={onDragOver}
      onDrop={onDrop}
      // We own the keyboard delete path ourselves via a document-level
      // handler (see useEffect above) so we can drive it straight from the
      // workflow store without the one-render lag of RF's internal state.
      // Setting this to `null` disables RF's built-in handler to avoid
      // double-deletes.
      deleteKeyCode={null}
      // Shift+drag = selection box regardless of where it starts (see the
      // shiftHeld useEffect above for the why).
      nodesDraggable={!shiftHeld}
      fitView={rfNodes.length > 0}
      fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        animated: false,
        style: {
          stroke: "var(--datatype-any)",
          strokeWidth: 1.5,
        },
      }}
      className="!bg-transparent"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        color="var(--color-muted-foreground)"
        style={{ opacity: 0.18 }}
      />
      {rfNodes.length > 0 && (
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          className="hidden lg:block"
          style={{
            right: "0.75rem",
            bottom: "0.75rem",
            width: 180,
            height: 120,
          }}
          maskColor="oklch(0.135 0 0 / 50%)"
          nodeColor="oklch(0.4 0.06 73)"
        />
      )}
      <Controls
        position="bottom-left"
        showInteractive={false}
        style={{ bottom: "0.75rem", left: "0.75rem" }}
      >
        <ThemeControlButton />
      </Controls>
    </ReactFlow>
  );
}
