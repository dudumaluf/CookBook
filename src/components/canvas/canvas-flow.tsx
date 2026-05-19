"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
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
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

import { BaseNode } from "@/components/nodes/base-node";

/* ────────────────────────────────────────────────────────────────────────── */
/* React Flow ↔ workflow-store bridge                                         */
/* ────────────────────────────────────────────────────────────────────────── */

type FlowNodeData = {
  kind: string;
  config: unknown;
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
  const removeNode = useWorkflowStore((s) => s.removeNode);

  if (!schema) {
    return (
      <div className="rounded-md border border-destructive bg-card px-3 py-2 text-xs text-destructive">
        Unknown node kind: {data.kind}
      </div>
    );
  }

  const Body = schema.Body;

  return (
    <BaseNode
      nodeId={id}
      schema={schema}
      selected={Boolean(selected)}
      onDelete={() => removeNode(id)}
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

function toFlowNode(n: NodeInstance): FlowNode {
  return {
    id: n.id,
    type: "cookbook",
    position: n.position,
    data: { kind: n.kind, config: n.config },
  };
}

function toFlowEdge(e: WorkflowEdge): RfEdge {
  return {
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    animated: false,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* CanvasFlow                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * React Flow canvas wired to the workflow store. The store is the source of
 * truth; React Flow's internal state is derived from it via memos.
 *
 * Change handlers translate React Flow events back to store mutations. We
 * only act on changes the store cares about (position, removal, selection,
 * new connections).
 */
export function CanvasFlow() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const moveNode = useWorkflowStore((s) => s.moveNode);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const removeEdge = useWorkflowStore((s) => s.removeEdge);
  const addEdge = useWorkflowStore((s) => s.addEdge);
  const setSelectedNodeIds = useWorkflowStore((s) => s.setSelectedNodeIds);

  const rfNodes = useMemo(() => nodes.map(toFlowNode), [nodes]);
  const rfEdges = useMemo(() => edges.map(toFlowEdge), [edges]);

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
      const selectionChanges: string[] | null = (() => {
        const sel = changes.filter((c) => c.type === "select");
        if (sel.length === 0) return null;
        // Compute the new selection set from current + changes.
        const current = new Set<string>();
        for (const c of changes) {
          if (c.type === "select" && c.selected) current.add(c.id);
        }
        return Array.from(current);
      })();

      for (const c of changes) {
        if (c.type === "position" && c.position) {
          pendingMoves.current.set(c.id, c.position);
        } else if (c.type === "remove") {
          removeNode(c.id);
        }
      }
      if (pendingMoves.current.size > 0) {
        queueMicrotask(flushMoves);
      }
      if (selectionChanges) {
        setSelectedNodeIds(selectionChanges);
      }
    },
    [removeNode, flushMoves, setSelectedNodeIds],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === "remove") removeEdge(c.id);
      }
    },
    [removeEdge],
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

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
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
