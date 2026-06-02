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
import {
  GENERATION_DRAG_MIME,
  parseGenerationDrag,
} from "@/lib/library/generation-drag";
import {
  RECIPE_DRAG_MIME,
  parseRecipeDrag,
} from "@/lib/library/recipe-drag";
import { cleanupGroupIfOrphan } from "@/lib/library/cleanup-orphan-group";
import { handleExternalFilesDrop } from "@/lib/library/handle-external-files-drop";
import { instantiateRecipeOnCanvas } from "@/lib/recipes/instantiate";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import { handleAssetDrop } from "@/lib/library/handle-asset-drop";
import { getSpawnPosition, setSpawnPositionGetter } from "@/lib/canvas/spawn-position";
import { tryHandleClipboardKey } from "@/lib/canvas/clipboard";
import {
  extractImagesFromClipboard,
  isEditablePasteTarget,
} from "@/lib/canvas/handle-canvas-paste";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

import { BaseNode } from "@/components/nodes/base-node";
import { toast } from "sonner";

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

  // Slice 6.6 — composite nodes derive their handle list from
  // `config.exposedInputs/Outputs`. When a schema declares these
  // resolver functions, evaluate them per-instance; otherwise fall
  // back to the static schema arrays inside BaseNode.
  const dynamicInputs = schema.getInputs
    ? schema.getInputs(data.config)
    : undefined;
  const dynamicOutputs = schema.getOutputs
    ? schema.getOutputs(data.config)
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
      inputs={dynamicInputs}
      outputs={dynamicOutputs}
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

  // Expose a viewport-aware spawn-position getter so consumers outside the
  // ReactFlowProvider (the Add Node popover, the clipboard paste path) can
  // place nodes at the current viewport center instead of a fixed coord.
  // Registered on mount, cleared on unmount — see `spawn-position.ts`.
  useEffect(() => {
    setSpawnPositionGetter(() => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      return screenToFlowPosition({ x: cx, y: cy });
    });
    return () => setSpawnPositionGetter(null);
  }, [screenToFlowPosition]);

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
          // Capture iterator's linked groupId before removal so we
          // can run `cleanupUntitledGroupIfOrphan` afterwards (Slice
          // 5.6e). Non-iterator removals: groupId is empty, cleanup
          // helper no-ops.
          const node = useWorkflowStore
            .getState()
            .nodes.find((n) => n.id === c.id);
          const groupId =
            node?.kind === "image-iterator"
              ? ((node.config as { groupId?: unknown })?.groupId ?? "")
              : "";
          removeNode(c.id);
          if (typeof groupId === "string" && groupId.length > 0) {
            cleanupGroupIfOrphan(groupId);
          }
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
  //
  // ## Iterator cleanup (Slice 5.6e, ADR-0032)
  //
  // Deleting an iterator may orphan the linked `Untitled` group it
  // owned. We capture each iterator's `groupId` BEFORE removal, then
  // call `cleanupUntitledGroupIfOrphan` on the asset store after the
  // workflow-store mutation lands. The cleanup walks the post-removal
  // workflow nodes to confirm no other iterator still references the
  // group; the group is dropped iff `isUntitled === true` AND the
  // `linkedNodeIds` arg is empty.
  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (
        tryHandleDeleteKey(event, () => {
          const s = useWorkflowStore.getState();
          return {
            selectedNodeIds: s.selectedNodeIds,
            selectedEdgeIds: s.selectedEdgeIds,
            removeNode: (id: string) => {
              const node = s.nodes.find((n) => n.id === id);
              const groupId =
                node?.kind === "image-iterator"
                  ? ((node.config as { groupId?: unknown })?.groupId ?? "")
                  : "";
              s.removeNode(id);
              if (typeof groupId === "string" && groupId.length > 0) {
                cleanupGroupIfOrphan(groupId);
              }
            },
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

  // Clipboard shortcuts — ⌘C / ⌘V (and ⌘D = duplicate) act on the current
  // node selection. The handler is editable-aware (skips when the user is
  // typing in an input / textarea / contentEditable) so plain text copy in
  // the prompt bar / node textareas keeps working.
  //
  // The keyboard plumbing is exported as `tryHandleClipboardKey` for
  // unit testing; the React layer just dispatches store mutations + reads
  // the current selection.
  useEffect(() => {
    function handler(event: KeyboardEvent) {
      void tryHandleClipboardKey(event, () => {
        const s = useWorkflowStore.getState();
        return {
          nodes: s.nodes,
          edges: s.edges,
          selectedNodeIds: s.selectedNodeIds,
          addNode: s.addNode,
          addEdge: s.addEdge,
          renameNode: s.renameNode,
          resizeNode: s.resizeNode,
          setSelectedNodeIds: s.setSelectedNodeIds,
        };
      });
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Image paste — when the user copies an image off a webpage and
  // hits ⌘V (or Ctrl+V) over the canvas, we treat it as a "paste an
  // image input node" gesture. Skips when the user is typing in an
  // input / textarea / contentEditable so plain text paste in the
  // prompt bar / node textareas keeps working. Falls through (no
  // preventDefault) when the clipboard has no image content so the
  // node-clipboard handler above still gets a shot at the event for
  // node copy/paste.
  useEffect(() => {
    function handler(event: ClipboardEvent) {
      if (isEditablePasteTarget(event.target)) return;
      const images = extractImagesFromClipboard(event.clipboardData);
      if (images.length === 0) return;
      event.preventDefault();
      const position = getSpawnPosition();
      void handleExternalFilesDrop({
        files: images,
        position,
      }).then((res) => {
        if (res.spawned.length > 0) {
          toast.success(
            `Pasted ${res.spawned.length} image${res.spawned.length === 1 ? "" : "s"}`,
          );
        }
        for (const err of res.errors) toast.error(err);
      });
    }
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
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

  // Library asset drag OR Gallery generation drag (Slice 6.5) — accept
  // iff one of our custom MIMEs is present. We ALSO accept native OS
  // file drags (Files MIME, set by the browser when the user drags
  // images/videos/audio off the desktop or another app) so the canvas
  // can spawn the right input node automatically. Other foreign drags
  // still fall through to the browser's default behaviour.
  const onDragOver = useCallback((event: React.DragEvent) => {
    const types = event.dataTransfer.types;
    if (
      types.includes(ASSET_DRAG_MIME) ||
      types.includes(GENERATION_DRAG_MIME) ||
      types.includes(RECIPE_DRAG_MIME) ||
      types.includes("Files")
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      // Slice 6.6 — Library → canvas drag of a recipe card. We fetch
      // the full recipe (subgraph) lazily here so the drag payload
      // stays small. Mode "node" spawns a single composite; "expand"
      // instantiates the saved subgraph as raw nodes (legacy / opt-in
      // for recipes saved with `is_node: false`).
      const recipeRaw = event.dataTransfer.getData(RECIPE_DRAG_MIME);
      if (recipeRaw) {
        event.preventDefault();
        const recipePayload = parseRecipeDrag(recipeRaw);
        if (recipePayload) {
          const dropPos = screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
          void getRecipeRepository()
            .get(recipePayload.recipeId)
            .then((recipe) => {
              if (!recipe) return;
              if (recipePayload.mode === "node") {
                // Spawn a single composite node — its config carries
                // the entire subgraph + the exposed I/O list, so the
                // composite renders the right handles and execute()
                // recurses into runWorkflow.
                const ws = useWorkflowStore.getState();
                ws.addNode("composite", dropPos, {
                  recipeId: recipe.id,
                  recipeName: recipe.name,
                  recipeVersion: recipe.version,
                  subgraph: recipe.subgraph,
                  exposedInputs: recipe.subgraph.exposedInputs ?? [],
                  exposedOutputs: recipe.subgraph.exposedOutputs ?? [],
                  exposedParams: recipe.subgraph.exposedParams ?? [],
                });
              } else {
                // Expand subgraph mode — same path the assistant DSL
                // uses today (Slice 6.4).
                instantiateRecipeOnCanvas({
                  subgraph: recipe.subgraph,
                  position: dropPos,
                });
              }
            })
            .catch((err) => {
              console.warn("[canvas] recipe drop failed:", err);
            });
        }
        return;
      }

      // Slice 6.5 — Gallery → canvas drag. Each generation item spawns
      // a fresh node (image / text / video) at the drop point, offset
      // by 24px per index so multi-select drags fan out cleanly.
      const generationRaw = event.dataTransfer.getData(GENERATION_DRAG_MIME);
      if (generationRaw) {
        event.preventDefault();
        const genPayload = parseGenerationDrag(generationRaw);
        if (genPayload) {
          const dropPos = screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
          const ws = useWorkflowStore.getState();
          genPayload.items.forEach((item, idx) => {
            const offset = { x: dropPos.x + idx * 24, y: dropPos.y + idx * 24 };
            const out = item.output;
            if (out.type === "image" && out.value && out.value.url) {
              ws.addNode("image", offset, {
                url: out.value.url,
                ...(out.value.width !== undefined &&
                out.value.height !== undefined
                  ? { width: out.value.width, height: out.value.height }
                  : {}),
              });
            } else if (out.type === "text" && typeof out.value === "string") {
              ws.addNode("text", offset, { text: out.value });
            } else if (out.type === "video" && out.value && out.value.url) {
              ws.addNode("video", offset, { url: out.value.url });
            } else if (out.type === "audio" && out.value && out.value.url) {
              ws.addNode("audio", offset, { url: out.value.url });
            }
          });
        }
        return;
      }

      const raw = event.dataTransfer.getData(ASSET_DRAG_MIME);

      // External files dragged from the OS / another app — no in-app
      // MIME claimed the drop, but `dataTransfer.files` is populated.
      // Hand off to the shared drop helper so MIME / size policy and
      // the asset → node mapping stay in one place. Runs only when no
      // custom in-app MIME was set above so internal drags keep their
      // existing semantics untouched.
      if (!raw) {
        const externalFiles = Array.from(event.dataTransfer.files ?? []);
        if (externalFiles.length > 0) {
          event.preventDefault();
          const dropPos = screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
          void handleExternalFilesDrop({
            files: externalFiles,
            position: dropPos,
          }).then((res) => {
            if (res.spawned.length > 0) {
              toast.success(
                `Added ${res.spawned.length} node${res.spawned.length === 1 ? "" : "s"} to canvas`,
              );
            }
            for (const err of res.errors) toast.error(err);
            if (res.skipped > 0) {
              toast.error(
                `${res.skipped} file${res.skipped === 1 ? "" : "s"} skipped — unsupported type`,
              );
            }
          });
        }
        return;
      }
      event.preventDefault();

      const payload = parseAssetDrag(raw);
      if (!payload) return;

      // Hit-test: did the drop land on an existing React Flow node?
      // RF renders every node as `.react-flow__node[data-id="…"]` so a
      // `closest()` walk from the actual DOM target picks the deepest
      // node ancestor (handles drops on the body / header / handles).
      // Note: when the drop lands on an iterator, the iterator's body
      // listener (Slice 5.6.1) usually handles it FIRST and stops
      // propagation. The hit-test below is defensive in case the
      // event still bubbles up — same dispatcher / same action set.
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
            const cfg = (targetNode.config ?? {}) as { groupId?: unknown };
            if (typeof cfg.groupId === "string") {
              dropIteratorGroupId = cfg.groupId;
            }
          }
        }
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      handleAssetDrop({
        payload,
        target:
          dropNodeId && dropNodeKind
            ? {
                nodeId: dropNodeId,
                nodeKind: dropNodeKind,
                iteratorGroupId: dropIteratorGroupId,
              }
            : undefined,
        position,
      });

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
