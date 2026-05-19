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

  /**
   * Add a node of the given kind at a canvas position. Returns the new id.
   *
   * `initialConfig` is shallow-merged on top of the schema's `defaultConfig`.
   * Used by the library drag handler to bake in `{ url, assetId }` etc. when
   * spawning from an asset drop.
   */
  addNode: (
    kind: string,
    position: { x: number; y: number },
    initialConfig?: Record<string, unknown>,
  ) => string;
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

      addNode: (kind, position, initialConfig) => {
        const schema = nodeRegistry.get(kind);
        if (!schema) {
          console.warn(`workflow-store.addNode: unknown kind "${kind}"`);
          return "";
        }
        const id = makeId(kind);
        // Clone defaultConfig so mutating one instance never leaks into the
        // schema or other instances. JSON round-trip is fine because configs
        // are serialized to localStorage anyway.
        const baseConfig = JSON.parse(
          JSON.stringify(schema.defaultConfig),
        ) as Record<string, unknown>;
        const node: NodeInstance = {
          id,
          kind,
          position,
          config: { ...baseConfig, ...(initialConfig ?? {}) },
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
      // v2 (no schema change vs v1): bumped during Slice 1 polish for a dev
      // wipe; v1 and v2 share the same shape, so `migrate` is a pass-through.
      // Future *schema* changes should bump the version AND add a real
      // case here that transforms the persisted state.
      version: 2,
      migrate: (persistedState, version) => {
        // v1 → v2: shape unchanged. Just pass through so existing user data
        // is preserved instead of being silently discarded.
        if (version === 1) {
          return persistedState as Partial<WorkflowState>;
        }
        return persistedState as Partial<WorkflowState>;
      },
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
