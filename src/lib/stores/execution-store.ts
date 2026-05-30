import { create } from "zustand";

import { nodeRegistry } from "@/lib/engine/registry";
import {
  runWorkflow,
  type ExecutionCache,
  type ExecutionCacheEntry,
} from "@/lib/engine/run-workflow";
import type {
  ExecutionHistoryEntry,
  ExecutionRecord,
} from "@/types/node";

import { useWorkflowStore } from "./workflow-store";

/**
 * Cap for per-node history (Slice 5.8). Tuned so "I want to revisit a
 * good generation 5 runs ago" works without bloating memory. Tune up
 * if user feedback says it's too low.
 */
export const HISTORY_CAP = 10;

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

  /**
   * "Run-here" partial run (Slice 5.8). Runs `endNodeId` plus all of
   * its upstream ancestors. Records of nodes outside that subgraph are
   * preserved (so the UI keeps showing the previous full-run's results
   * for unrelated branches). Cancels any in-flight run first, same as
   * `startRun`.
   */
  startRunFrom: (endNodeId: string) => Promise<void>;

  /**
   * Surgical "run only this node" (default for the per-node Run button).
   * Runs `nodeId` reusing the CURRENT recorded outputs of its upstream
   * ancestors — those ancestors are not re-executed. Only the target and
   * ancestors that have no recorded output yet (e.g. an empty upstream
   * LLM the target depends on) actually run. This is what users expect
   * from "regenerate this one node": clicking Run on an image node never
   * silently re-runs the LLM / prompt chain above it.
   */
  startRunNode: (nodeId: string) => Promise<void>;

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

  /**
   * Switch the active project (Phase 3). Wipes the in-memory records +
   * output cache and loads the new project's persisted cache namespace so
   * one project never serves another's cached outputs. Called by the
   * ProjectSession controller on open / switch.
   */
  setActiveProject: (projectId: string | null) => void;
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
 * Persist the output cache across reloads (multimodal arc fix). Without this,
 * reloading the page (e.g. to pick up a deploy) drops the cache, so a
 * Run-here on a downstream node re-executes — and re-pays for — upstream
 * nodes that already produced a result (the LLM "regenerating" complaint).
 *
 * Safe because: cache-busting nodes (gen with seed === -1) never READ the
 * cache, so a persisted-but-stale image URL is never replayed; the cacheable
 * cases (LLM text, etc.) are durable. Capped to the most recent N entries to
 * bound localStorage. Best-effort — any storage/parse error is swallowed.
 */
const CACHE_STORAGE_KEY = "cookbook-exec-cache-v1";
const CACHE_PERSIST_CAP = 300;

/**
 * The cache is namespaced per project so two projects never serve each
 * other's outputs (and the cap is per-project). `setActiveProject` swaps
 * this when the user opens a different project.
 */
let activeCacheKey = CACHE_STORAGE_KEY;

function cacheKeyFor(projectId: string | null): string {
  return projectId ? `${CACHE_STORAGE_KEY}::${projectId}` : CACHE_STORAGE_KEY;
}

function persistCache(): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Array.from(sessionCache.entries()).slice(
      -CACHE_PERSIST_CAP,
    );
    window.localStorage.setItem(activeCacheKey, JSON.stringify(entries));
  } catch {
    // Quota or serialization error — caching is an optimization, not
    // load-bearing. Drop silently.
  }
}

function loadCache(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(activeCacheKey);
    if (!raw) return;
    const entries = JSON.parse(raw) as [string, ExecutionCacheEntry][];
    for (const [hash, entry] of entries) sessionCache.set(hash, entry);
  } catch {
    // Corrupt payload — ignore; we'll rebuild the cache from runs.
  }
}

// Rehydrate on first import (client only). Pre-project: the default key.
loadCache();

/**
 * In-flight AbortController for the current run, if any. Lives in
 * module scope so `cancelRun()` and `startRun()` (which preempts) can
 * reach it without going through React render cycles.
 */
let currentController: AbortController | null = null;

/**
 * Shared run launcher (Slice 5.8 refactor) — used by both `startRun`
 * and `startRunFrom`. Centralises the runId guard, abort wiring,
 * onProgress + history append, and isRunning lifecycle so the two
 * entry points stay byte-aligned.
 */
async function launchRun({
  get,
  set,
  endAtNodeId,
  seedOutputs,
}: {
  get: () => ExecutionState;
  set: (
    partial:
      | Partial<ExecutionState>
      | ((state: ExecutionState) => Partial<ExecutionState>),
  ) => void;
  endAtNodeId: string | undefined;
  seedOutputs?: ReadonlyMap<string, ExecutionCacheEntry>;
}): Promise<void> {
  if (currentController) {
    currentController.abort();
    currentController = null;
  }

  const runId = get().runId + 1;
  const controller = new AbortController();
  currentController = controller;

  const { nodes, edges } = useWorkflowStore.getState();

  // Never wipe records — a generated result persists until the node is
  // deleted (or an explicit future "clear"). Both full and partial runs
  // PRESERVE prior records: onProgress overwrites each node as it runs and
  // appends to its history on `done`, so a full Run now ACCUMULATES history
  // instead of resetting it. Nodes not touched by the run keep their last
  // result on screen.
  set({
    runId,
    isRunning: true,
    records: get().records,
  });

  try {
    await runWorkflow({
      nodes,
      edges,
      registry: nodeRegistry,
      cache: sessionCache,
      signal: controller.signal,
      ...(endAtNodeId !== undefined ? { endAtNodeId } : {}),
      ...(seedOutputs !== undefined ? { seedOutputs } : {}),
      onProgress: (nodeId, record) => {
        if (get().runId !== runId) return;
        const prev = get().records.get(nodeId);
        const prevHistory = prev?.history ?? [];
        // History append (Slice 5.8): only on `done` records that
        // carry actual output. Cached replays don't add entries.
        // For non-`done` transitions (pending, running, cached, …) we
        // PRESERVE the prior history so the cursor in the body keeps
        // referring to past entries while the current run is in flight.
        let nextRecord = record;
        if (record.status === "done" && record.output !== undefined) {
          const entry: ExecutionHistoryEntry = {
            output: record.output,
            usage: record.usage,
            elapsedMs: record.elapsedMs,
            runId,
            timestamp: Date.now(),
          };
          const history = [...prevHistory, entry].slice(-HISTORY_CAP);
          nextRecord = { ...record, history };
        } else if (prevHistory.length > 0) {
          nextRecord = { ...record, history: prevHistory };
        }
        const next = new Map(get().records);
        next.set(nodeId, nextRecord);
        set({ records: next });
      },
    });
  } finally {
    if (currentController === controller) currentController = null;
    if (get().runId === runId) set({ isRunning: false });
    // Persist the (now-warmer) cache so a reload doesn't force re-running
    // upstream nodes on the next Run-here.
    persistCache();
  }
}

export const useExecutionStore = create<ExecutionState>()((set, get) => ({
  runId: 0,
  isRunning: false,
  records: new Map(),

  getRecord: (nodeId) => get().records.get(nodeId),

  startRun: async () => {
    await launchRun({ get, set, endAtNodeId: undefined });
  },

  startRunFrom: async (endNodeId: string) => {
    await launchRun({ get, set, endAtNodeId: endNodeId });
  },

  startRunNode: async (nodeId: string) => {
    // Seed every ancestor's current output by node-id so they're reused
    // verbatim (no re-execution). Exclude the target so it always runs.
    // Ancestors with no recorded output are absent here → they execute on
    // demand (covers an empty upstream the target depends on).
    const seedOutputs = new Map<string, ExecutionCacheEntry>();
    for (const [id, rec] of get().records) {
      if (id === nodeId) continue;
      if (rec.output === undefined) continue;
      seedOutputs.set(id, {
        output: rec.output,
        ...(rec.usage ? { usage: rec.usage } : {}),
      });
    }
    await launchRun({ get, set, endAtNodeId: nodeId, seedOutputs });
  },

  cancelRun: () => {
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
    // Free the UI immediately. The aborted run's `finally` also resets
    // isRunning when its promise settles, but if an upstream request hangs
    // without honoring the abort, that could be slow — so we reset here too.
    // Belt-and-suspenders against a stuck `isRunning` (greyed Run buttons).
    if (get().isRunning) set({ isRunning: false });
  },

  clearRun: () => {
    set({ records: new Map() });
  },

  clearCache: () => {
    sessionCache.clear();
    persistCache();
  },

  setActiveProject: (projectId) => {
    // Abort anything in flight from the previous project.
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
    sessionCache.clear();
    activeCacheKey = cacheKeyFor(projectId);
    loadCache();
    set({ records: new Map(), isRunning: false });
  },
}));

/** Test-only: reset module-scoped state. */
export function _resetExecutionForTests(): void {
  sessionCache.clear();
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(activeCacheKey);
      window.localStorage.removeItem(CACHE_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
  activeCacheKey = CACHE_STORAGE_KEY;
  currentController?.abort();
  currentController = null;
  useExecutionStore.setState({
    runId: 0,
    isRunning: false,
    records: new Map(),
  });
}
