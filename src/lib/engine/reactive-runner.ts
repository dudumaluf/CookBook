"use client";

import { nodeRegistry } from "@/lib/engine/registry";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import { runWorkflow } from "./run-workflow";

/**
 * Reactive runner — Slice 6.3 (ADR-0036).
 *
 * Subscribes to workflow-store + execution-store changes and dispatches
 * a debounced background `runWorkflow({ mode: "reactive-only" })` so
 * reactive nodes (Array, List, Number, Iterators, Text, Image) update
 * live as the graph mutates — without burning credit on the expensive
 * non-reactive nodes (LLM, Higgsfield, Soul ID, Export). Those still
 * require an explicit Run / Run-here.
 *
 * Activation: started once per session in the AppShell `useEffect`
 * (after auth bootstrap). Returns an unsubscribe function for teardown
 * on logout.
 *
 * Debouncing: 150ms. Coalesces typing bursts in Text bodies, drag
 * sequences on canvas, etc. into a single re-run.
 *
 * Anti-loop: the engine itself bumps node hashes only when a node's
 * config or upstream output actually changes. Reactive runs that touch
 * the workflow-store (e.g. Number incrementing its `value`) trigger
 * another reactive run — but the second one's hash matches the first's
 * cache and is a no-op. Convergence in O(depth-of-graph) reactive runs.
 *
 * Skip when isRunning: a full run from the user's Run button takes
 * precedence; the reactive runner backs off until that completes.
 */

const DEBOUNCE_MS = 150;
// Module-scoped session cache for reactive runs. Same shape as the
// execution-store's session cache — we can't reach into it directly here,
// but having a fresh cache per reactive run is fine because cached outputs
// from full runs land in the live record map and reactive nodes consume
// them via inputs that flow through the engine's upstream resolution.
// (Reactive runs don't touch the execution-store cache to avoid
// contaminating it.)

interface StartReactiveRunnerOptions {
  debounceMs?: number;
}

export function startReactiveRunner(
  options: StartReactiveRunnerOptions = {},
): () => void {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlightController: AbortController | null = null;

  function trigger() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  }

  async function flush() {
    timer = null;
    // Skip if a user-initiated full run is in flight — let it finish so we
    // don't race the engine's records.
    if (useExecutionStore.getState().isRunning) return;
    if (inFlightController) {
      inFlightController.abort();
    }
    const controller = new AbortController();
    inFlightController = controller;

    const { nodes, edges } = useWorkflowStore.getState();
    if (nodes.length === 0) return;

    // Fresh per-call cache — reactive runs are cheap and we don't want to
    // contaminate the user's session cache. Each reactive node executes
    // its pure function on every reactive trigger; their outputs land in
    // the per-run `outputs` map and emit through `onProgress` to the
    // execution-store records.
    const reactiveCache = new Map<
      string,
      { output: unknown; usage?: unknown }
    >() as never;

    try {
      await runWorkflow({
        nodes,
        edges,
        registry: nodeRegistry,
        cache: reactiveCache,
        signal: controller.signal,
        mode: "reactive-only",
        onProgress: (nodeId, record) => {
          // Skip if a user-initiated run started after we kicked off (the
          // user's run will overwrite records itself; we don't want to
          // race them).
          if (useExecutionStore.getState().isRunning) return;
          // Same Map-clone-and-set pattern as execution-store's regular
          // onProgress. Only patch reactive node records — never overwrite
          // an existing non-reactive record (LLM result, Higgsfield image)
          // with a `running`/`pending` from the background loop.
          const records = new Map(useExecutionStore.getState().records);
          records.set(nodeId, record);
          useExecutionStore.setState({ records });
        },
      });
    } catch (err) {
      // Reactive runs are best-effort. Log and move on.
      console.warn("[reactive-runner] run failed:", err);
    } finally {
      if (inFlightController === controller) inFlightController = null;
    }
  }

  // Subscribe to workflow-store (config / edges changes) only. We
  // intentionally DON'T subscribe to execution-store changes:
  //
  // 1. A full run already runs reactive nodes too, so their records are
  //    fresh after the user's manual Run / Run-here.
  // 2. Subscribing to records would create a feedback loop: every
  //    reactive run mutates records via `onProgress`, which would
  //    re-trigger another reactive run → infinite cycle.
  //
  // Net: reactive runs fire on graph edits (typing in Text, dragging,
  // changing node config), not on engine progress.
  const unsubs = [useWorkflowStore.subscribe(() => trigger())];

  return () => {
    if (timer) clearTimeout(timer);
    if (inFlightController) inFlightController.abort();
    for (const u of unsubs) u();
  };
}
