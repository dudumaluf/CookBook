import { create } from "zustand";

import { nodeRegistry } from "@/lib/engine/registry";
import {
  runWorkflow,
  type ExecutionCache,
} from "@/lib/engine/run-workflow";
import type { ExecutionRecord } from "@/types/node";

import { useWorkflowStore } from "./workflow-store";

/**
 * Execution store — live status + outputs for the most recent run.
 *
 * Strict separation from `workflow-store`:
 *   - workflow-store holds the *declarative* graph (nodes + edges + selection).
 *     It's the source of truth for "what would run".
 *   - execution-store holds the *runtime* of the most recent run (per-node
 *     status, last output, error, elapsed time).
 *
 * Why separate:
 *   - Runs are ephemeral; the graph isn't.
 *   - workflow-store is persisted to localStorage — execution state must
 *     not be (stale "running" records on reload would lie to the user).
 *   - Slice 3.2 onward will add a per-session output cache here that the
 *     engine consults to skip re-runs; keeping it isolated from the graph
 *     store means cache invalidation rules live next to the cache itself.
 *
 * In-memory only. Re-load the page → empty cache → first run re-executes
 * everything. Persistent caching is a Slice 5+ concern (along with SQLite
 * for the workflow itself).
 */

export interface ExecutionState {
  /**
   * Monotonically increasing run id. Bumped by `startRun()` so progress
   * callbacks from an old, cancelled run can be ignored if they arrive
   * after a new run started.
   */
  runId: number;
  /** True between `startRun()` and the engine's final resolve / reject. */
  isRunning: boolean;
  /** Per-node live state. Missing nodeId ⇒ status is implicitly "idle". */
  records: Map<string, ExecutionRecord>;

  /**
   * Read-only accessor for components — Zustand selectors over `records`
   * Map are awkward (the Map reference changes on every set, busting
   * `useSyncExternalStore`'s equality), so we expose a typed getter.
   */
  getRecord: (nodeId: string) => ExecutionRecord | undefined;

  /**
   * Kick off a run of the current workflow graph. Cancels any in-flight
   * run first (the new run's records replace the old ones; old callbacks
   * are dropped via the `runId` guard).
   */
  startRun: () => Promise<void>;

  /** Abort the in-flight run. No-op if nothing is running. */
  cancelRun: () => void;

  /**
   * Forget every record so all nodes render as "idle" again. Does NOT
   * clear the output cache — re-running with the same inputs is still
   * instant. Use `clearCache()` to drop the cache itself.
   */
  clearRun: () => void;

  /** Drop every cached output. Next run will re-execute every node. */
  clearCache: () => void;
}

/**
 * Output cache shared across runs in the same session. Lives outside the
 * Zustand store because (a) it's a Map, which Zustand handles poorly for
 * deep-equality selection, and (b) the engine mutates it inline during a
 * run — putting it in store state would force a clone-and-set on every
 * cache write, which defeats the cache's whole point.
 */
const sessionCache: ExecutionCache = new Map();

/**
 * In-flight AbortController for the current run, if any. Lives in
 * module scope so `cancelRun()` and `startRun()` (which preempts) can
 * reach it without going through React render cycles.
 */
let currentController: AbortController | null = null;

export const useExecutionStore = create<ExecutionState>()((set, get) => ({
  runId: 0,
  isRunning: false,
  records: new Map(),

  getRecord: (nodeId) => get().records.get(nodeId),

  startRun: async () => {
    // Preempt any in-flight run. The old run's onProgress callbacks check
    // `runId` against the store and bail if they're stale.
    if (currentController) {
      currentController.abort();
      currentController = null;
    }

    const runId = get().runId + 1;
    const controller = new AbortController();
    currentController = controller;

    const { nodes, edges } = useWorkflowStore.getState();
    set({ runId, isRunning: true, records: new Map() });

    try {
      await runWorkflow({
        nodes,
        edges,
        registry: nodeRegistry,
        cache: sessionCache,
        signal: controller.signal,
        onProgress: (nodeId, record) => {
          // Drop progress from an old run — could only happen if startRun
          // races with itself, but cheap insurance.
          if (get().runId !== runId) return;
          // Map mutation needs a new reference for Zustand to re-render
          // any component subscribed to `records`. Cloning is O(n) in the
          // graph size, which is fine — graphs are tiny.
          const next = new Map(get().records);
          next.set(nodeId, record);
          set({ records: next });
        },
      });
    } finally {
      if (currentController === controller) currentController = null;
      // Only flip `isRunning` off if we're still the active run.
      if (get().runId === runId) set({ isRunning: false });
    }
  },

  cancelRun: () => {
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
  },

  clearRun: () => {
    set({ records: new Map() });
  },

  clearCache: () => {
    sessionCache.clear();
  },
}));

/** Test-only: reset module-scoped state. */
export function _resetExecutionForTests(): void {
  sessionCache.clear();
  currentController?.abort();
  currentController = null;
  useExecutionStore.setState({
    runId: 0,
    isRunning: false,
    records: new Map(),
  });
}
