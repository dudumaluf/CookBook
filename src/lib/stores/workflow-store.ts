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
  selectedEdgeIds: string[];

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
  /**
   * Set or clear a node's per-instance label.
   * - Trimmed non-empty string → stored as the label.
   * - Empty / whitespace-only / `undefined` → clears the label so the
   *   header falls back to the schema title.
   */
  renameNode: (id: string, label: string | undefined) => void;
  /**
   * Persist user-set dimensions for a node (ADR-0028 — bottom-right drag
   * handle). `size = undefined` (or both fields undefined) clears the
   * per-instance override so the schema's `defaultWidth` / `defaultHeight`
   * take over again. Only fired by canvas-flow's `onNodesChange` when
   * React Flow reports a `dimensions` change with `setAttributes` truthy
   * (i.e. the user actively dragged the resize handle — not a passive
   * content-measurement event).
   */
  resizeNode: (
    id: string,
    size: { width?: number; height?: number } | undefined,
  ) => void;

  addEdge: (edge: Omit<WorkflowEdge, "id">) => string | undefined;
  removeEdge: (id: string) => void;

  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  clear: () => void;
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Return a NodeInstance with the `size` property removed entirely (vs set
 * to `undefined`). Keeps the persisted JSON clean when the user resets a
 * resized node — important because the migration walks every field, and
 * `{ size: undefined }` would still be in the payload.
 */
function stripSize(node: NodeInstance): NodeInstance {
  if (node.size === undefined) return node;
  // Explicit destructure rather than rest-spread-omit so the runtime payload
  // doesn't carry an enumerable `size: undefined` key after the strip.
  const { size: _stripped, ...rest } = node;
  void _stripped;
  return rest;
}

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],

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
        set((state) => {
          // Cascade: edges touching the removed node go too. Capture their
          // ids first so we can also drop them from `selectedEdgeIds` (or
          // a deleted node + selected dangling edge would leave a stale
          // ghost id in selection that the next Backspace would try to
          // re-remove, no-op-ing the keyboard handler).
          const cascadingEdgeIds = new Set(
            state.edges
              .filter((e) => e.source === id || e.target === id)
              .map((e) => e.id),
          );
          return {
            nodes: state.nodes.filter((n) => n.id !== id),
            edges: state.edges.filter((e) => !cascadingEdgeIds.has(e.id)),
            selectedNodeIds: state.selectedNodeIds.filter((nid) => nid !== id),
            selectedEdgeIds: state.selectedEdgeIds.filter(
              (eid) => !cascadingEdgeIds.has(eid),
            ),
          };
        });
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

      renameNode: (id, label) => {
        const trimmed = label?.trim();
        const next = trimmed && trimmed.length > 0 ? trimmed : undefined;
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === id ? { ...n, label: next } : n,
          ),
        }));
      },

      resizeNode: (id, size) => {
        // Normalise: an all-undefined size is the same as no size at all —
        // strip the field entirely so the rehydrated state stays clean.
        // We round to integer px (NodeResizeControl emits floats during a
        // drag) so the persisted state isn't churned by sub-pixel jitter
        // and so the rehydrated value reads cleanly in devtools.
        const next =
          size && (size.width !== undefined || size.height !== undefined)
            ? {
                ...(size.width !== undefined
                  ? { width: Math.round(size.width) }
                  : {}),
                ...(size.height !== undefined
                  ? { height: Math.round(size.height) }
                  : {}),
              }
            : undefined;
        set((state) => ({
          nodes: state.nodes.map((n) => {
            if (n.id !== id) return n;
            // Skip if nothing actually changed — avoids a no-op render
            // when React Flow re-emits the same dimensions (it does this
            // on every drag move, even when the rounded value is stable).
            if (
              (n.size?.width ?? undefined) === (next?.width ?? undefined) &&
              (n.size?.height ?? undefined) === (next?.height ?? undefined)
            ) {
              return n;
            }
            return next === undefined ? stripSize(n) : { ...n, size: next };
          }),
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
        set((state) => ({
          edges: state.edges.filter((e) => e.id !== id),
          // Same defensive cleanup as removeNode: keep the selection set
          // free of dangling ids so the keyboard delete path stays honest.
          selectedEdgeIds: state.selectedEdgeIds.filter((eid) => eid !== id),
        }));
      },

      setSelectedNodeIds: (ids) => {
        set({ selectedNodeIds: ids });
      },

      setSelectedEdgeIds: (ids) => {
        set({ selectedEdgeIds: ids });
      },

      clear: () => {
        set({
          nodes: [],
          edges: [],
          selectedNodeIds: [],
          selectedEdgeIds: [],
        });
      },
    }),
    {
      name: "cookbook.workflow",
      storage: createJSONStorage(() => localStorage),
      // v7: SoulID node lands (ADR-0029, Slice 4.2). Config shape is
      // `{ assetId?, customReferenceId?, variant?, name?, thumbnailUrl? }`
      // where everything is optional but `customReferenceId + variant`
      // together are what `execute()` needs. Migration sanitises any
      // pre-existing soul-id config in place, dropping fields that aren't
      // strings / valid variants so the engine never sees garbage.
      // v6: NodeInstance gained an optional `size: { width?, height? }` for
      // user-resized nodes (ADR-0028). Additive — no existing payload
      // breaks; the migrate just sanitises any pre-existing `size` to a
      // legal shape (positive finite numbers) so a hand-edited localStorage
      // value can't crash React Flow with NaN dimensions.
      // v5: LLM Text gained optional `temperature`, `maxTokens`, `reasoning`
      // (ADR-0026 settings popover). All optional → no destructive change to
      // existing v4 configs; the migrate just sanitises any pre-existing
      // fields (e.g. someone hand-editing localStorage) to valid shapes.
      // v4: LLM Text moved user/system off the node body (now input handles
      // only) so its config collapsed to `{ model }` (ADR-0022 properties
      // panel redesign). Migration discards any prior inline user/system
      // values — they were going to vanish from the UI either way; users
      // can re-wire them with Text nodes.
      // v3: LLMTextNodeConfig renamed `prompt` → `user` and added `system`.
      // v2: dev wipe; shape unchanged vs v1.
      // v8: Image Iterator moved its multi-edge `images` input to internal
      // storage (`config.assetIds: string[] + cursor + selectionMode`), per
      // ADR-0031. Existing graphs are migrated by walking every Image
      // Iterator: edges targeting `images` are resolved to upstream Image
      // node `assetId`s and collapsed into the iterator's new `assetIds`
      // array (selectionMode "all" matches today's fan-out-everything
      // behaviour bit-for-bit). The orphan edges are then dropped. The
      // text-iterator node is brand new in v8 — no migration path needed
      // (no legacy graphs reference it).
      version: 8,
      migrate: (persistedState) => {
        // Walk every node and patch any llm-text configs in place. Idempotent
        // and tolerant of partial shapes from any prior version. The whole
        // migrate funnels every legacy llm-text config (with `prompt`, with
        // `user`/`system`, or just `model`) down to the v5 shape:
        //   { model, temperature?, maxTokens?, reasoning? }
        // — preserving any v5-format optional fields if they're already
        // present and within range, otherwise stripping them.
        // v6 adds an optional top-level `size` on every node (regardless of
        // kind) — handled at the end of the walk so all node kinds get the
        // sanitisation, not just llm-text.
        const state = (persistedState ?? {}) as Partial<WorkflowState>;
        if (!state.nodes) return state;
        const validSoulIdVariants = new Set(["v1", "v2", "cinema"]);
        const migratedNodes = state.nodes.map((nRaw) => {
          let n = nRaw;
          if (n.kind === "soul-id") {
            // v7 sanitisation. Required fields land as `undefined` if the
            // shape is wrong; the node body's empty state ("Import a
            // character") will render and the user can re-wire.
            const old = (n.config ?? {}) as Record<string, unknown>;
            const next: Record<string, unknown> = {};
            if (typeof old.assetId === "string") next.assetId = old.assetId;
            if (
              typeof old.customReferenceId === "string" &&
              old.customReferenceId.length > 0
            ) {
              next.customReferenceId = old.customReferenceId;
            }
            if (
              typeof old.variant === "string" &&
              validSoulIdVariants.has(old.variant)
            ) {
              next.variant = old.variant;
            }
            if (typeof old.name === "string") next.name = old.name;
            if (
              typeof old.thumbnailUrl === "string" ||
              old.thumbnailUrl === null
            ) {
              next.thumbnailUrl = old.thumbnailUrl;
            }
            n = { ...n, config: next };
          }
          if (n.kind === "llm-text") {
            const old = (n.config ?? {}) as Record<string, unknown>;
            const next: Record<string, unknown> = {
              model:
                typeof old.model === "string"
                  ? (old.model as string)
                  : "anthropic/claude-sonnet-4.5",
            };
            // Pass through `temperature` only if it's a finite number in
            // [0, 2]. Anything else is silently dropped so we don't carry
            // garbage that the server's Zod would reject mid-run.
            if (
              typeof old.temperature === "number" &&
              Number.isFinite(old.temperature) &&
              old.temperature >= 0 &&
              old.temperature <= 2
            ) {
              next.temperature = old.temperature;
            }
            // Pass through `maxTokens` only if positive integer.
            if (
              typeof old.maxTokens === "number" &&
              Number.isInteger(old.maxTokens) &&
              old.maxTokens > 0
            ) {
              next.maxTokens = old.maxTokens;
            }
            if (typeof old.reasoning === "boolean") {
              next.reasoning = old.reasoning;
            }
            n = { ...n, config: next };
          }
          // v6 size sanitisation — applies to every node kind. Width / height
          // must be finite positive numbers; anything else is stripped so a
          // bogus persisted value can't make NodeResizeControl emit NaN or
          // freeze React Flow's measurement loop. Rounds to integer (matches
          // the rounding `resizeNode()` already does on writes).
          const rawSize = (n as Partial<NodeInstance>).size as
            | { width?: unknown; height?: unknown }
            | undefined;
          if (rawSize !== undefined) {
            const cleaned: { width?: number; height?: number } = {};
            if (
              typeof rawSize.width === "number" &&
              Number.isFinite(rawSize.width) &&
              rawSize.width > 0
            ) {
              cleaned.width = Math.round(rawSize.width);
            }
            if (
              typeof rawSize.height === "number" &&
              Number.isFinite(rawSize.height) &&
              rawSize.height > 0
            ) {
              cleaned.height = Math.round(rawSize.height);
            }
            n =
              cleaned.width !== undefined || cleaned.height !== undefined
                ? { ...n, size: cleaned }
                : stripSize(n);
          }
          return n;
        });

        // ────────────────────────────────────────────────────────────────
        // v8 — Image Iterator goes from multi-edge input to internal
        // assetIds[] storage (ADR-0031, Slice 5.5).
        //
        // For every image-iterator node:
        //   1. Sanitise the existing config — assetIds[], cursor (>= 0
        //      integer), selectionMode (one of the known modes), optional
        //      range — even if it's already on v8 (idempotency path for
        //      hand-edited localStorage).
        //   2. If `assetIds` is empty AND there are still edges targeting
        //      this iterator's old `images` handle, walk those edges and
        //      collect each upstream Image node's `assetId` into the new
        //      array. selectionMode defaults to "all" so a migrated graph
        //      runs bit-for-bit identically to the pre-v8 fan-out.
        //   3. Drop the now-orphan edges from state.edges so persisted
        //      JSON stays clean and the canvas doesn't render dead lines.
        //
        // text-iterator is brand new in v8 — no migration path needed,
        // but we still sanitise the config defensively for any
        // hand-edited payload.
        const validSelectionModes = new Set([
          "fixed",
          "increment",
          "decrement",
          "random",
          "range",
          "all",
        ]);
        const sanitiseSelectionMode = (raw: unknown): string =>
          typeof raw === "string" && validSelectionModes.has(raw)
            ? raw
            : "all";
        const sanitiseCursor = (raw: unknown): number => {
          if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
          const t = Math.trunc(raw);
          return t < 0 ? 0 : t;
        };
        const sanitiseRange = (raw: unknown):
          | { start: number; end: number }
          | undefined => {
          if (
            typeof raw !== "object" ||
            raw === null ||
            !("start" in raw) ||
            !("end" in raw)
          ) {
            return undefined;
          }
          const r = raw as { start?: unknown; end?: unknown };
          if (
            typeof r.start !== "number" ||
            typeof r.end !== "number" ||
            !Number.isFinite(r.start) ||
            !Number.isFinite(r.end)
          ) {
            return undefined;
          }
          return {
            start: Math.trunc(r.start),
            end: Math.trunc(r.end),
          };
        };

        const orphanEdgeIds = new Set<string>();
        const persistedEdges = (state.edges ?? []) as readonly WorkflowEdge[];
        // Pre-index Image nodes by id so iterator migration is O(N+E) total.
        const imageNodeAssetById = new Map<string, string>();
        for (const n of migratedNodes) {
          if (n.kind !== "image") continue;
          const cfg = (n.config ?? {}) as { assetId?: unknown };
          if (typeof cfg.assetId === "string" && cfg.assetId.length > 0) {
            imageNodeAssetById.set(n.id, cfg.assetId);
          }
        }

        const v8Nodes = migratedNodes.map((nRaw) => {
          if (nRaw.kind !== "image-iterator" && nRaw.kind !== "text-iterator") {
            return nRaw;
          }
          const old = (nRaw.config ?? {}) as Record<string, unknown>;

          if (nRaw.kind === "text-iterator") {
            const next: Record<string, unknown> = {
              texts: Array.isArray(old.texts)
                ? old.texts.filter((t): t is string => typeof t === "string")
                : [],
              cursor: sanitiseCursor(old.cursor),
              selectionMode: sanitiseSelectionMode(old.selectionMode),
            };
            const range = sanitiseRange(old.range);
            if (range) next.range = range;
            return { ...nRaw, config: next };
          }

          // image-iterator. Collect existing assetIds (idempotent path) or
          // fall through to harvesting wired upstream edges.
          const assetIds = Array.isArray(old.assetIds)
            ? old.assetIds.filter(
                (id): id is string => typeof id === "string" && id.length > 0,
              )
            : [];
          if (assetIds.length === 0) {
            // Walk edges targeting `images` and resolve each source.
            for (const edge of persistedEdges) {
              if (
                edge.target !== nRaw.id ||
                edge.targetHandle !== "images"
              ) {
                continue;
              }
              orphanEdgeIds.add(edge.id);
              const upstreamAssetId = imageNodeAssetById.get(edge.source);
              if (upstreamAssetId) assetIds.push(upstreamAssetId);
            }
          } else {
            // If the iterator already carries assetIds (hand-edited or
            // round-tripped from v8), still drop any stale edges targeting
            // the now-defunct `images` handle so the persisted JSON stays
            // clean.
            for (const edge of persistedEdges) {
              if (edge.target === nRaw.id && edge.targetHandle === "images") {
                orphanEdgeIds.add(edge.id);
              }
            }
          }

          const next: Record<string, unknown> = {
            assetIds,
            cursor: sanitiseCursor(old.cursor),
            selectionMode: sanitiseSelectionMode(old.selectionMode),
          };
          const range = sanitiseRange(old.range);
          if (range) next.range = range;
          return { ...nRaw, config: next };
        });

        const v8Edges =
          orphanEdgeIds.size > 0
            ? persistedEdges.filter((e) => !orphanEdgeIds.has(e.id))
            : (state.edges ?? []);

        return { ...state, nodes: v8Nodes, edges: v8Edges };
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
