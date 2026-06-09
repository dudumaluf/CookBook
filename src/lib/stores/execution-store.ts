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
 * Cap for per-node history (Slice 5.8 → 6.6).
 *
 * Originally 10 — small enough that the project document stayed light and
 * the body's `‹ N/M ›` cursor didn't get unwieldy. User feedback was
 * straightforward: "don't limit it." So this is now `Infinity`. Practical
 * implications callers should be aware of:
 *
 *  - `Array.prototype.slice(-Infinity)` returns the whole array, so the
 *    three slice sites in `execution-store.ts` + `lib/project/document.ts`
 *    keep working unchanged — they're effectively no-ops now but stay in
 *    place so reverting to a finite cap is a one-line change.
 *  - The history is serialized into the project document on save; growth
 *    is unbounded in principle. In practice each entry is URLs + usage
 *    metadata (no bytes), so a heavy node accumulating 1000 entries is
 *    still on the order of ~2 MB — Supabase JSONB handles that fine.
 *  - The Gallery (`cookbook_generations`) remains the durable, queryable
 *    corpus and has its own per-node cap of 50 in the repo. Nothing here
 *    affects that.
 *
 * If a future project balloons past comfortable serialization size, the
 * intended escape hatch is a per-project setting + an explicit "trim
 * history" affordance — not silently re-introducing a global cap.
 */
export const HISTORY_CAP: number = Number.POSITIVE_INFINITY;

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
   * Pick a different history entry as the node's current output.
   *
   * Updates `record.cursorIndex` AND mirrors `record.output` / `usage` /
   * `elapsedMs` to that entry's values so downstream consumers (engine
   * seeding, reactive runner) flow the user-selected output, not always
   * the latest. Reactive runs see the change automatically; surgical
   * "Run this node" runs also receive an explicit per-entry seed hash so
   * the downstream cache distinguishes selections.
   *
   * No-op when the node has no history yet. Index is clamped into range
   * defensively.
   */
  setHistoryCursor: (nodeId: string, cursorIndex: number) => void;

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
 * In-flight runs keyed by run id. Multiple surgical per-node runs can overlap
 * (e.g. two Seedance nodes rendering in parallel); full / run-here runs
 * preempt everything else first.
 */
const activeRuns = new Map<number, AbortController>();

function syncIsRunning(
  set: (
    partial:
      | Partial<ExecutionState>
      | ((state: ExecutionState) => Partial<ExecutionState>),
  ) => void,
): void {
  set({ isRunning: activeRuns.size > 0 });
}

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
  preemptOthers = false,
}: {
  get: () => ExecutionState;
  set: (
    partial:
      | Partial<ExecutionState>
      | ((state: ExecutionState) => Partial<ExecutionState>),
  ) => void;
  endAtNodeId: string | undefined;
  seedOutputs?: ReadonlyMap<string, ExecutionCacheEntry>;
  /** When true, abort every other in-flight run before starting (full / run-here). */
  preemptOthers?: boolean;
}): Promise<void> {
  if (preemptOthers) {
    for (const c of activeRuns.values()) c.abort();
    activeRuns.clear();
  }

  const runId = get().runId + 1;
  const controller = new AbortController();
  activeRuns.set(runId, controller);

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
        if (!activeRuns.has(runId)) return;
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
          // Auto-jump cursor to the new latest entry. Users can still
          // navigate back via the IteratorCursor in the body — this just
          // ensures a fresh result is what they see right after a run.
          nextRecord = {
            ...record,
            history,
            cursorIndex: history.length - 1,
          };
        } else if (prevHistory.length > 0) {
          // Preserve prior history + cursor position during running /
          // pending / cached transitions so the user's selection isn't
          // wiped mid-run.
          nextRecord = {
            ...record,
            history: prevHistory,
            ...(prev?.cursorIndex !== undefined
              ? { cursorIndex: prev.cursorIndex }
              : {}),
          };
        }
        const next = new Map(get().records);
        next.set(nodeId, nextRecord);
        set({ records: next });
      },
    });
  } finally {
    activeRuns.delete(runId);
    syncIsRunning(set);
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
    await launchRun({ get, set, endAtNodeId: undefined, preemptOthers: true });
  },

  startRunFrom: async (endNodeId: string) => {
    await launchRun({
      get,
      set,
      endAtNodeId: endNodeId,
      preemptOthers: true,
    });
  },

  startRunNode: async (nodeId: string) => {
    // Seed every ancestor's current output by node-id so they're reused
    // verbatim (no re-execution). Exclude the target so it always runs.
    // Ancestors with no recorded output are absent here → they execute on
    // demand (covers an empty upstream the target depends on).
    //
    // Cursor-aware seeding (history bug fix): if the ancestor has history
    // and the user has navigated the body cursor to an OLDER entry, seed
    // with that entry's output AND a per-entry hash. The hash makes the
    // downstream cache key distinguish selections — running the target
    // twice with cursor on different upstream entries returns different
    // results instead of aliasing on the latest. When the cursor is on
    // the latest entry (or undefined), we pass the regular `rec.output`
    // with no hash override, preserving today's cache hits.
    const seedOutputs = new Map<string, ExecutionCacheEntry>();
    for (const [id, rec] of get().records) {
      if (id === nodeId) continue;
      if (rec.output === undefined) continue;
      const history = rec.history ?? [];
      const latest = history.length - 1;
      const cursor =
        rec.cursorIndex !== undefined &&
        rec.cursorIndex >= 0 &&
        rec.cursorIndex <= latest
          ? rec.cursorIndex
          : latest;
      const isOlder = history.length > 0 && cursor >= 0 && cursor < latest;
      const entry = isOlder ? history[cursor] : undefined;

      const seedOutput = entry?.output ?? rec.output;
      const seedUsage = entry?.usage ?? rec.usage;
      seedOutputs.set(id, {
        output: seedOutput,
        ...(seedUsage ? { usage: seedUsage } : {}),
        ...(isOlder && entry
          ? { hash: `${id}::run-${entry.runId}` }
          : {}),
      });
    }
    await launchRun({ get, set, endAtNodeId: nodeId, seedOutputs });
  },

  setHistoryCursor: (nodeId, cursorIndex) => {
    const records = new Map(get().records);
    const rec = records.get(nodeId);
    if (!rec || !rec.history || rec.history.length === 0) return;
    const idx = Math.min(
      Math.max(0, Math.trunc(cursorIndex)),
      rec.history.length - 1,
    );
    if (rec.cursorIndex === idx) return;
    const entry = rec.history[idx]!;
    // Mirror the selected entry into the record so reactive consumers +
    // engine seeding pick it up. We intentionally MUTATE `output` and
    // `usage` here — the history entry is the source of truth for what
    // the user has selected, and downstream code should see exactly that.
    const next: ExecutionRecord = {
      ...rec,
      cursorIndex: idx,
      output: entry.output,
      usage: entry.usage,
      ...(entry.elapsedMs !== undefined ? { elapsedMs: entry.elapsedMs } : {}),
    };
    records.set(nodeId, next);
    set({ records });
  },

  cancelRun: () => {
    for (const c of activeRuns.values()) c.abort();
    activeRuns.clear();
    // Free the UI immediately. Each run's `finally` also decrements, but if
    // an upstream request hangs without honoring abort, reset here too.
    set({ isRunning: false });
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
    for (const c of activeRuns.values()) c.abort();
    activeRuns.clear();
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
  for (const c of activeRuns.values()) c.abort();
  activeRuns.clear();
  useExecutionStore.setState({
    runId: 0,
    isRunning: false,
    records: new Map(),
  });
}
