"use client";

import { nodeRegistry } from "@/lib/engine/registry";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { isRecipeEditActive } from "@/lib/stores/recipe-edit-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { StandardizedOutput } from "@/types/node";

import { runWorkflow } from "./run-workflow";

/**
 * Reactive runner — Slice 6.3 (ADR-0036) + Slice 6.4 hotfix.
 *
 * Subscribes to workflow-store changes and dispatches a debounced
 * background `runWorkflow({ mode: "reactive-only" })` so reactive nodes
 * (Array, List, Number, Iterators, Text, Image) update live as the
 * graph mutates — without burning credit on the expensive non-reactive
 * nodes (LLM, Higgsfield, Soul ID, Export). Those still require an
 * explicit Run / Run-here.
 *
 * Slice 6.4 hotfix: also subscribes to `execution-store.isRunning` and
 * triggers a reactive flush on the `true → false` falling edge (i.e.
 * right after a full Run / Run-here completes). That propagates fresh
 * non-reactive outputs (LLM, Higgsfield) to reactive consumers
 * downstream so Array → List → ... refresh against the new upstream
 * without the user having to nudge anything. We ONLY listen to that
 * specific transition (not every record patch) so reactive runs don't
 * feedback-loop into themselves.
 *
 * Phase B1 hotfix (ADR-0051): we ALSO short-circuit the flush when the
 * recipe-edit store is active. The recipe-edit canvas hydrates the
 * workflow-store with the recipe's subgraph, which would otherwise
 * trigger an immediate reactive flush of every reactive node inside the
 * recipe (sometimes hundreds, in nested cases). The user is editing,
 * not running — they'll click Run / Run-here when they want output.
 *
 * Activation: started once per session in the AppShell `useEffect`
 * (after auth bootstrap). Returns an unsubscribe function for teardown
 * on logout.
 *
 * Debouncing: 150ms. Coalesces typing bursts in Text bodies, drag
 * sequences on canvas, etc. into a single re-run.
 *
 * Each flush builds a `prevOutputs` map from execution-store records
 * (see Slice 6.4 hotfix in run-workflow.ts) so non-reactive node
 * outputs from the last full run flow into reactive consumers without
 * needing them in the per-flush cache.
 *
 * Skip when isRunning OR isRecipeEditActive: a full run from the user's
 * Run button takes precedence; the reactive runner backs off until
 * that completes. Edit mode skips entirely.
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
    // Skip when the recipe-edit canvas is active (ADR-0051). Editing a
    // recipe is a structural workflow, not a runtime one; reactive nodes
    // shouldn't fire just because the user dragged a Text node into the
    // saved subgraph. The user runs explicitly via Run / Run-here.
    if (isRecipeEditActive()) return;
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

    // Slice 6.4 hotfix — bridge the gap for non-reactive nodes (LLM,
    // Higgsfield, etc.). Their last-known outputs live in the
    // execution-store records from the most recent full Run; passing
    // them via `prevOutputs` lets the engine flow those into reactive
    // consumers without re-running the expensive nodes. Without this,
    // every reactive flush would hand reactive nodes empty inputs and
    // wipe their visible output.
    const records = useExecutionStore.getState().records;
    const prevOutputs = new Map<
      string,
      StandardizedOutput | StandardizedOutput[]
    >();
    for (const [id, r] of records) {
      if (
        (r.status === "done" || r.status === "cached") &&
        r.output !== undefined
      ) {
        prevOutputs.set(id, r.output);
      }
    }

    try {
      await runWorkflow({
        nodes,
        edges,
        registry: nodeRegistry,
        cache: reactiveCache,
        signal: controller.signal,
        mode: "reactive-only",
        prevOutputs,
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
          // Keep the last output visible during a reactive re-run: a bare
          // "running" emit carries no output and would blank a node body for
          // a frame (a spinner flash). Carrying the prior output forward keeps
          // live previews — Image Transform / Image Stack (ADR-0075) — smooth.
          const prev = records.get(nodeId);
          if (
            record.status === "running" &&
            record.output === undefined &&
            prev?.output !== undefined
          ) {
            records.set(nodeId, { ...record, output: prev.output });
          } else {
            records.set(nodeId, record);
          }
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

  // Subscribe to workflow-store (config / edges changes) — every mutation
  // there indicates the user might want reactive consumers to refresh.
  //
  // ALSO subscribe to execution-store BUT only watch the falling edge of
  // `isRunning` (true → false). That happens exactly once per full Run /
  // Run-here completion, signaling that non-reactive outputs (LLM,
  // Higgsfield) just landed and downstream reactive nodes should be
  // re-derived against the new upstream. We deliberately do NOT trigger
  // on every record patch — that would create a feedback loop because
  // reactive runs themselves write records via `onProgress`.
  let lastIsRunning = useExecutionStore.getState().isRunning;
  const unsubs = [
    useWorkflowStore.subscribe(() => trigger()),
    useExecutionStore.subscribe((state) => {
      if (lastIsRunning && !state.isRunning) {
        // A full run just completed — reactive nodes might be stale.
        trigger();
      }
      lastIsRunning = state.isRunning;
    }),
  ];

  return () => {
    if (timer) clearTimeout(timer);
    if (inFlightController) inFlightController.abort();
    for (const u of unsubs) u();
  };
}
