import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { ExecutionStatus } from "@/types/node";

/**
 * ADR-0069 F14 — shared "await + summarize" helper for run_*
 * tools.
 *
 * Old behavior: tools called `startRun()` and returned
 * `{ ok: true, runId }` synchronously. The Promise from `startRun`
 * was discarded — meaning the LLM saw "ok: true" and ASSUMED the
 * run was complete, then often emitted a final user-facing message
 * along the lines of "I've regenerated everything for you" while
 * the engine was still running. When something failed mid-run, the
 * LLM had no signal at all and reported success against an error
 * state.
 *
 * New behavior: caller passes the launch promise; we await it,
 * inspect the records of the affected nodes, and return a structured
 * summary the LLM can reason about without a follow-up
 * `read_node_state`. Errors bubble up as `errors: […]` so the LLM
 * can apologise / re-attempt instead of falsely declaring victory.
 */

export interface RunNodeSummary {
  id: string;
  kind: string;
  status: ExecutionStatus | "idle";
  /** Populated when status === "error". */
  error?: string;
  /** ms spent in the engine for this node — undefined for cached / idle. */
  elapsedMs?: number;
  /** True iff this node was actually executed (not cached / skipped). */
  ran: boolean;
}

export interface RunCompletionResult {
  ok: boolean;
  runId: number;
  /** Wall-clock ms inside the launch promise. */
  durationMs: number;
  /** All affected nodes (target + ancestors + reactive descendants). */
  nodeSummary: RunNodeSummary[];
  /** Just the failed nodes — convenience for the LLM. */
  errors: Array<{ id: string; kind: string; error: string }>;
  /** Total cost across all nodes that reported usage in this run. */
  totalCostUsd: number;
  /** True iff at least one node has status "error". */
  hadErrors: boolean;
}

/**
 * Await the run promise + summarise the affected nodes.
 *
 * `affectedNodeIds`:
 *   - undefined → summarise every node on the canvas (full run).
 *   - id list → only those nodes (run_from / regenerate scope).
 */
export async function awaitRunCompletion({
  runPromise,
  affectedNodeIds,
}: {
  runPromise: Promise<void>;
  affectedNodeIds?: ReadonlyArray<string>;
}): Promise<RunCompletionResult> {
  const startedAt = Date.now();
  const ws = useWorkflowStore.getState();
  // Snapshot the runId at launch so the report is unambiguous even if
  // a follow-up run starts concurrently (it cannot under our store, but
  // belt-and-suspenders).
  const runIdBefore = useExecutionStore.getState().runId;
  await runPromise;
  const durationMs = Date.now() - startedAt;
  const exec = useExecutionStore.getState();
  // The store bumps runId at the start of `launchRun`, so the "real"
  // id for THIS run is `runIdBefore + 1` if a launch happened.
  // Falling back to the current runId is fine — the engine guarantees
  // it's strictly monotonic.
  const runId = Math.max(runIdBefore + 1, exec.runId);

  const targetIds =
    affectedNodeIds && affectedNodeIds.length > 0
      ? Array.from(new Set(affectedNodeIds))
      : ws.nodes.map((n) => n.id);

  const nodeSummary: RunNodeSummary[] = [];
  const errors: RunCompletionResult["errors"] = [];
  let totalCostUsd = 0;

  for (const id of targetIds) {
    const node = ws.nodes.find((n) => n.id === id);
    if (!node) continue;
    const rec = exec.records.get(id);
    const status = rec?.status ?? "idle";
    const summary: RunNodeSummary = {
      id,
      kind: node.kind,
      status,
      ran: status === "done" || status === "error",
    };
    if (rec?.elapsedMs !== undefined) summary.elapsedMs = rec.elapsedMs;
    if (rec?.usage && typeof rec.usage.costUsd === "number") {
      totalCostUsd += rec.usage.costUsd;
    }
    if (status === "error") {
      const err = rec?.error ?? "unknown error";
      summary.error = err;
      errors.push({ id, kind: node.kind, error: err });
    }
    nodeSummary.push(summary);
  }

  return {
    ok: errors.length === 0,
    runId,
    durationMs,
    nodeSummary,
    errors,
    totalCostUsd,
    hadErrors: errors.length > 0,
  };
}
