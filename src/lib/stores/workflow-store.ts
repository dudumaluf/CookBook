import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { NodeInstance, WorkflowEdge } from "@/types/node";
import { nodeRegistry } from "@/lib/engine/registry";

/**
 * Workflow store: the *data* of the current canvas graph.
 *
 * Strict separation from `execution-store` (Slice 3): this store knows nothing
 * about run state, outputs, cache hits, or progress. It only holds the
 * declarative shape of the graph (nodes + edges + selection) and persists it.
 *
 * Persistence: localStorage in Day-1-to-M0a. SQLite (Drizzle) replaces this
 * in M0a Slice 5 via the Repository abstraction — same store interface, swap
 * the backing layer.
 */
export interface WorkflowState {
  nodes: NodeInstance[];
  edges: WorkflowEdge[];
  selectedNodeIds: string[];

  /** Add a node of the given kind at a canvas position. Returns the new id. */
  addNode: (kind: string, position: { x: number; y: number }) => string;
  removeNode: (id: string) => void;
  updateNodeConfig: <TConfig = unknown>(
    id: string,
    update: Partial<TConfig>,
  ) => void;
  moveNode: (id: string, position: { x: number; y: number }) => void;

  addEdge: (edge: Omit<WorkflowEdge, "id">) => string | undefined;
  removeEdge: (id: string) => void;

  setSelectedNodeIds: (ids: string[]) => void;
  clear: () => void;
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      selectedNodeIds: [],

      addNode: (kind, position) => {
        const schema = nodeRegistry.get(kind);
        if (!schema) {
          console.warn(`workflow-store.addNode: unknown kind "${kind}"`);
          return "";
        }
        const id = makeId(kind);
        const node: NodeInstance = {
          id,
          kind,
          position,
          // Clone defaultConfig so mutating one instance never leaks into the
          // schema or other instances. JSON round-trip is fine because configs
          // are serialized to localStorage anyway.
          config: JSON.parse(JSON.stringify(schema.defaultConfig)),
        };
        set((state) => ({ nodes: [...state.nodes, node] }));
        return id;
      },

      removeNode: (id) => {
        set((state) => ({
          nodes: state.nodes.filter((n) => n.id !== id),
          edges: state.edges.filter(
            (e) => e.source !== id && e.target !== id,
          ),
          selectedNodeIds: state.selectedNodeIds.filter((nid) => nid !== id),
        }));
      },

      updateNodeConfig: (id, update) => {
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === id
              ? { ...n, config: { ...(n.config as object), ...update } }
              : n,
          ),
        }));
      },

      moveNode: (id, position) => {
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === id ? { ...n, position } : n,
          ),
        }));
      },

      addEdge: (edge) => {
        // Reject self-loops and duplicate edges into the same target handle
        // (a single handle can only accept one connection unless its schema
        // marks it `multiple: true` — enforced here via the registry).
        if (edge.source === edge.target) return undefined;

        const targetSchema = nodeRegistry.get(
          get().nodes.find((n) => n.id === edge.target)?.kind ?? "",
        );
        const targetHandle = targetSchema?.inputs.find(
          (i) => i.id === edge.targetHandle,
        );
        if (!targetHandle?.multiple) {
          const existing = get().edges.find(
            (e) =>
              e.target === edge.target &&
              e.targetHandle === edge.targetHandle,
          );
          if (existing) return undefined;
        }

        const id = makeId("edge");
        set((state) => ({ edges: [...state.edges, { id, ...edge }] }));
        return id;
      },

      removeEdge: (id) => {
        set((state) => ({ edges: state.edges.filter((e) => e.id !== id) }));
      },

      setSelectedNodeIds: (ids) => {
        set({ selectedNodeIds: ids });
      },

      clear: () => {
        set({ nodes: [], edges: [], selectedNodeIds: [] });
      },
    }),
    {
      name: "cookbook.workflow",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Same pattern as layout-store and project-store: avoid SSR mismatch by
      // rehydrating manually in the AppShell after mount.
      skipHydration: true,
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
      }),
    },
  ),
);
