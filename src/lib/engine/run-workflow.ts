import type {
  ExecutionRecord,
  NodeExecuteResult,
  NodeInstance,
  NodeOutputWithUsage,
  NodeUsage,
  StandardizedOutput,
  WorkflowEdge,
} from "@/types/node";

import { NodeRegistry } from "./registry";
import { hashString, stableStringify } from "./hash";

/* ────────────────────────────────────────────────────────────────────────── */
/* Public types                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * One cached entry. We persist `usage` alongside the output so a cache
 * hit can credit the same cost / tokens to the queue as the original run
 * (otherwise re-running an LLM call with the same inputs would look like
 * it was free in the cumulative run total — confusing when comparing
 * "what I spent this session" vs "what I'd have spent without the cache").
 */
export interface ExecutionCacheEntry {
  output: StandardizedOutput | StandardizedOutput[];
  usage?: NodeUsage;
}

/**
 * Output cache shared across runs of the same session.
 *
 * Map keyed by node-content hash → `{ output, usage? }`. A `WeakRef`
 * would be overkill — graphs are small and outputs are tiny JSON. We
 * accept that the cache lives for the page's lifetime and gets GC'd on
 * reload (no persistence in Slice 3.1 — that's a Slice 5 concern along
 * with SQLite).
 */
export type ExecutionCache = Map<string, ExecutionCacheEntry>;

export interface RunWorkflowOptions {
  nodes: readonly NodeInstance[];
  edges: readonly WorkflowEdge[];
  registry: NodeRegistry;
  /** Shared across runs in the same session for cache reuse. */
  cache: ExecutionCache;
  /** Called whenever a node transitions to a new status. */
  onProgress: (nodeId: string, record: ExecutionRecord) => void;
  /** Aborts the run between nodes (and inside `execute()` for nodes that honour it). */
  signal: AbortSignal;
  /**
   * Cap for in-flight `execute()` calls during a fan-out. Defaults to
   * `DEFAULT_MAX_CONCURRENT` (4 — matches Higgsfield's keypair limit).
   * Bumped via tests / future configurability.
   */
  maxConcurrent?: number;
  /**
   * "Run-here" mode (Slice 5.8): when set, the engine restricts the run
   * to `endAtNodeId` and **all of its upstream ancestors** (BFS reverse
   * over edges). Nodes outside this subgraph are skipped entirely — no
   * pending / cancelled records emitted for them, so the caller can
   * preserve a previous full-run's UI state for those nodes.
   *
   * If `endAtNodeId` doesn't exist in `nodes`, the run resolves
   * immediately with `ok: true` and an empty records map (defensive —
   * matches how a no-op run would behave).
   */
  endAtNodeId?: string;

  /**
   * Run mode (Slice 6.3 / ADR-0036).
   *
   * `"full"` (default) — runs every node end-to-end, the historical
   * behaviour. Used by the explicit Run button + Run-here.
   *
   * `"reactive-only"` — only executes nodes flagged `schema.reactive ===
   * true` (cheap pure-function utilities: Text, Image, Number, Array,
   * List, Iterators). Nodes flagged `reactive: false` (LLM Text,
   * Higgsfield, Soul ID, Export) are SKIPPED — their cached output (if
   * present) flows downstream, but they never re-execute. Used by the
   * background `reactive-runner` subscription so changing a Text input
   * propagates Array → List → ... live without burning credit on the
   * expensive nodes upstream.
   *
   * In reactive-only the engine doesn't seed "pending" records —
   * background runs shouldn't sweep the UI's status chips.
   */
  mode?: "full" | "reactive-only";

  /**
   * Slice 6.4 hotfix — when running in reactive-only mode, this map carries
   * the last-known outputs of non-reactive nodes (LLM, Higgsfield, etc.)
   * so their results flow to reactive consumers downstream even when the
   * per-flush cache is empty.
   *
   * Sourced from execution-store records by `reactive-runner` before each
   * flush. Without this, a reactive run that touches anything resets every
   * downstream reactive node's output to "no input → empty" because the
   * non-reactive upstream has no fresh cache to hit (each reactive flush
   * uses its own cache to avoid contaminating the user's session cache).
   *
   * Ignored in `mode: "full"` — full runs always execute every node from
   * scratch and don't need the bridge.
   */
  prevOutputs?: ReadonlyMap<string, StandardizedOutput | StandardizedOutput[]>;
}

export interface RunWorkflowResult {
  /** `true` if every reachable node finished (`done` or `cached`). */
  ok: boolean;
  /** Node id whose error stopped the run, if any. */
  failedNodeId?: string;
  /** Final per-node records (mirrors what `onProgress` already streamed). */
  records: Map<string, ExecutionRecord>;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Topological sort (Kahn's)                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface TopoResult {
  order: NodeInstance[];
  /** True iff the graph has a cycle (in which case `order` is partial). */
  hasCycle: boolean;
}

/**
 * Walk edges in reverse from `endNodeId`, collecting every ancestor.
 * Returns the filtered nodes + edges (Slice 5.8 — Run-here).
 *
 * Used by `runWorkflow` when `endAtNodeId` is provided. Defensive
 * against:
 *   - missing endNodeId → returns empty subgraph
 *   - cycles upstream (BFS uses a Set so we never loop)
 *   - dangling edges referencing absent nodes (skipped on output)
 */
export function computeAncestorSubgraph(
  endNodeId: string,
  nodes: readonly NodeInstance[],
  edges: readonly WorkflowEdge[],
): { nodes: NodeInstance[]; edges: WorkflowEdge[] } {
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(endNodeId)) return { nodes: [], edges: [] };
  const reachable = new Set<string>([endNodeId]);
  const queue: string[] = [endNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of edges) {
      if (e.target !== id) continue;
      if (!reachable.has(e.source) && nodeIds.has(e.source)) {
        reachable.add(e.source);
        queue.push(e.source);
      }
    }
  }
  return {
    nodes: nodes.filter((n) => reachable.has(n.id)),
    edges: edges.filter(
      (e) => reachable.has(e.source) && reachable.has(e.target),
    ),
  };
}

/**
 * Kahn's algorithm. Stable: ties broken by the original node order, which
 * matches how the canvas / workflow-store stores them, so the run order is
 * predictable for a given graph.
 */
export function topologicalSort(
  nodes: readonly NodeInstance[],
  edges: readonly WorkflowEdge[],
): TopoResult {
  const nodeById = new Map<string, NodeInstance>(
    nodes.map((n) => [n.id, n]),
  );
  // Incoming-edge count per node id.
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  // Adjacency: source → targets.
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    // Skip edges that reference nodes outside the working set — the engine
    // doesn't crash on dangling edges (workflow-store cleans them up, but
    // we're defensive here in case a caller passes a stale snapshot).
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const queue: NodeInstance[] = [];
  for (const n of nodes) if ((indegree.get(n.id) ?? 0) === 0) queue.push(n);

  const order: NodeInstance[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    order.push(n);
    for (const targetId of adj.get(n.id) ?? []) {
      const next = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, next);
      if (next === 0) queue.push(nodeById.get(targetId)!);
    }
  }
  return { order, hasCycle: order.length < nodes.length };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Cache key                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Hash a node + the hashes of every upstream that feeds it.
 *
 * The recipe is:
 *   hash( stableStringify({ kind, config, deps: [ {handle, sourceHash} ... ] }) )
 *
 * `deps` is sorted by `[targetHandle, sourceHash]` so the same incoming
 * connection set always produces the same key regardless of edge-insertion
 * order. The handle is included so that swapping which input a value feeds
 * (e.g. moving an edge from `system` to `user`) busts the cache.
 */
export function computeNodeHash(
  node: NodeInstance,
  upstreamHashesByTargetHandle: Map<string, string[]>,
): string {
  const deps: Array<{ handle: string; sourceHash: string }> = [];
  for (const [handle, hashes] of upstreamHashesByTargetHandle) {
    // Sort the source hashes too so multi-input handles (iterators) hash
    // deterministically regardless of which order edges were drawn.
    const sortedHashes = [...hashes].sort();
    for (const sourceHash of sortedHashes) deps.push({ handle, sourceHash });
  }
  deps.sort((a, b) =>
    a.handle === b.handle
      ? a.sourceHash.localeCompare(b.sourceHash)
      : a.handle.localeCompare(b.handle),
  );
  return hashString(
    stableStringify({ kind: node.kind, config: node.config, deps }),
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Runner                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Bound for in-flight executions during a fan-out (Slice 4.4 / ADR-0030).
 * Matches Higgsfield's per-keypair concurrent-requests cap so the engine
 * never races itself into 429s. Other providers (Fal) tolerate more, but
 * the iterator-fan-out path is image-gen-shaped today, so 4 is the safe
 * universal default.
 */
export const DEFAULT_MAX_CONCURRENT = 4;

/**
 * Run the workflow once.
 *
 * Topological serial walk with one fan-out exception (Slice 4.4):
 *   - Cycles → every node marked `error` with a "cycle detected" message.
 *   - For each node in order:
 *       1. Resolve its inputs by reading the outputs of upstream nodes
 *          (collected from edges). Handles with no incoming edge get
 *          `undefined`. Multi-input handles get an array.
 *       2. Detect FAN-OUT: when the only upstream feeding a single-input
 *          handle is a node whose schema declares `iterator: true` AND
 *          that node emitted an array, the engine runs `execute()` once
 *          per iterator item, in parallel (bounded by maxConcurrent).
 *          Outputs are concatenated into a flat array.
 *       3. Compute a content hash from `{ kind, config, deps }`.
 *       4. If the cache already has that hash, emit `cached` with the
 *          previous output.
 *       5. Otherwise emit `running`, await `execute()` (single or fan-out),
 *          store the output in the cache, emit `done`. Time the call so
 *          the UI can show how long the node took.
 *       6. On `execute()` throw: emit `error` and stop. Downstream nodes
 *          stay `pending` (which the store then upgrades to `cancelled`
 *          for clarity in the UI).
 *   - On `signal.aborted` between nodes: stop early; everything not yet
 *     finished becomes `cancelled`.
 *
 * Persistent caches and the bigger parallelism story (whole-graph
 * scheduling) are later slices.
 */
export async function runWorkflow(
  opts: RunWorkflowOptions,
): Promise<RunWorkflowResult> {
  const {
    nodes: rawNodes,
    edges: rawEdges,
    registry,
    cache,
    onProgress,
    signal,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    endAtNodeId,
    mode = "full",
    prevOutputs,
  } = opts;
  const isReactiveOnly = mode === "reactive-only";

  // Slice 5.8 — Run-here. If `endAtNodeId` is set, narrow the working
  // set to it + every upstream ancestor. Everything else stays out of
  // this run entirely (no pending emits, no cancellation noise) so
  // existing UI state for unrelated nodes is preserved by the caller.
  const { nodes, edges } =
    endAtNodeId !== undefined
      ? computeAncestorSubgraph(endAtNodeId, rawNodes, rawEdges)
      : { nodes: rawNodes as NodeInstance[], edges: rawEdges as WorkflowEdge[] };

  const records = new Map<string, ExecutionRecord>();

  // Empty subgraph — Run-here on a node that doesn't exist (or whose
  // id was stale). Resolve a successful no-op rather than crashing.
  if (nodes.length === 0) {
    return { ok: true, records };
  }

  function emit(id: string, record: ExecutionRecord) {
    records.set(id, record);
    onProgress(id, record);
  }

  // Cycle bail-out: mark every node `error` and return.
  const topo = topologicalSort(nodes, edges);
  if (topo.hasCycle) {
    for (const n of nodes) {
      emit(n.id, { status: "error", error: "Cycle detected in workflow" });
    }
    return {
      ok: false,
      failedNodeId: nodes.find((n) => !records.get(n.id))?.id,
      records,
    };
  }

  // Seed everyone as `pending` up-front so the UI can paint the whole run
  // shape immediately — better feedback than nodes popping into existence
  // one by one as the engine reaches them.
  //
  // In reactive-only mode we skip this: background runs shouldn't sweep
  // the UI's status chips into "pending" (would flicker every keystroke).
  // Each per-node emit during the run handles its own state.
  if (!isReactiveOnly) {
    for (const n of topo.order) emit(n.id, { status: "pending" });
  }

  // Per-node output map (live during this run, consumed by downstreams).
  const outputs = new Map<
    string,
    StandardizedOutput | StandardizedOutput[]
  >();
  // Per-node hash map (used to derive downstream hashes).
  const hashes = new Map<string, string>();
  // Pre-index edges by target for O(1) input collection per node.
  const edgesByTarget = new Map<string, WorkflowEdge[]>();
  for (const e of edges) {
    const bucket = edgesByTarget.get(e.target) ?? [];
    bucket.push(e);
    edgesByTarget.set(e.target, bucket);
  }

  for (const node of topo.order) {
    if (signal.aborted) {
      // Anything still pending becomes cancelled.
      for (const n of topo.order) {
        if (records.get(n.id)?.status === "pending") {
          emit(n.id, { status: "cancelled" });
        }
      }
      return { ok: false, records };
    }

    const schema = registry.get(node.kind);
    if (!schema) {
      emit(node.id, {
        status: "error",
        error: `Unknown node kind: ${node.kind}`,
      });
      return { ok: false, failedNodeId: node.id, records };
    }

    // Collect inputs from upstream outputs, grouped by target handle.
    // Track which (if any) handle is a fan-out source so the runner can
    // dispatch the iterator branch later.
    const inputs: Record<
      string,
      StandardizedOutput | StandardizedOutput[] | undefined
    > = {};
    const upstreamHashesByTargetHandle = new Map<string, string[]>();
    /** Iterator items keyed by the single-input handle they fan out into. */
    let fanOut:
      | { handle: string; items: StandardizedOutput[] }
      | undefined;

    for (const edge of edgesByTarget.get(node.id) ?? []) {
      const upstreamOutput = outputs.get(edge.source);
      const upstreamHash = hashes.get(edge.source);
      if (upstreamOutput === undefined || upstreamHash === undefined) {
        continue;
      }
      const handleInputs = inputs[edge.targetHandle];
      const isMulti =
        schema.inputs.find((i) => i.id === edge.targetHandle)?.multiple ??
        false;
      if (isMulti) {
        const arr = Array.isArray(handleInputs)
          ? handleInputs
          : handleInputs
            ? [handleInputs]
            : [];
        if (Array.isArray(upstreamOutput)) arr.push(...upstreamOutput);
        else arr.push(upstreamOutput);
        inputs[edge.targetHandle] = arr;
      } else {
        // Single input. Detect fan-out: upstream is iterator-flagged AND
        // the upstream's output is an array. Fan-out is mutually exclusive
        // across handles — only the first such handle wins (we never need
        // a 2D fan-out in the Soul Image Burst recipe; future slices can
        // generalise).
        const upstreamSchema = registry.get(
          nodes.find((n) => n.id === edge.source)?.kind ?? "",
        );
        const isIteratorSource =
          upstreamSchema?.iterator === true && Array.isArray(upstreamOutput);
        if (isIteratorSource && fanOut === undefined) {
          fanOut = {
            handle: edge.targetHandle,
            items: upstreamOutput as StandardizedOutput[],
          };
          // The per-iteration input for this handle is overridden in the
          // fan-out branch; for now leave inputs[handle] undefined.
        } else {
          // Legacy: single input picks the first item if the upstream is
          // an array (the workflow-store rejects 2nd edges into single
          // inputs, so this only happens for accidental array shape).
          inputs[edge.targetHandle] = Array.isArray(upstreamOutput)
            ? upstreamOutput[0]
            : upstreamOutput;
        }
      }
      const hashBucket =
        upstreamHashesByTargetHandle.get(edge.targetHandle) ?? [];
      hashBucket.push(upstreamHash);
      upstreamHashesByTargetHandle.set(edge.targetHandle, hashBucket);
    }

    const nodeHash = computeNodeHash(node, upstreamHashesByTargetHandle);
    hashes.set(node.id, nodeHash);

    // Cache hit? Same key for both single and fan-out modes — the cache
    // stores the final aggregated output either way.
    const cached = cache.get(nodeHash);
    if (cached !== undefined) {
      outputs.set(node.id, cached.output);
      emit(node.id, {
        status: "cached",
        output: cached.output,
        hash: nodeHash,
        ...(cached.usage ? { usage: cached.usage } : {}),
      });
      continue;
    }

    // Slice 6.3 — reactive-only mode. Non-reactive nodes (LLM, Higgsfield,
    // Soul ID, Export) NEVER auto-execute in reactive runs; they require
    // an explicit Run / Run-here. We've already let cached output flow
    // above, so reactive consumers downstream still see fresh inputs when
    // the cache is warm.
    //
    // Slice 6.4 hotfix: when no fresh cache hit, fall back to `prevOutputs`
    // (sourced from execution-store records by reactive-runner). That keeps
    // a previously-completed LLM result flowing into Array → List → ...
    // downstream so a reactive flush triggered by editing Array.delimiter
    // doesn't blow away every consumer's content.
    //
    // Important: do NOT emit a record here. The UI already shows the
    // user-facing record from the original full run; overwriting it with a
    // synthetic "cached" emit would re-fire generation-sync's auto-persist.
    if (isReactiveOnly && schema.reactive !== true) {
      const prev = prevOutputs?.get(node.id);
      if (prev !== undefined) {
        outputs.set(node.id, prev);
        hashes.set(node.id, nodeHash);
      }
      continue;
    }

    // Resolve execute() once. Capturing the narrowed reference here keeps
    // TS's control-flow analysis happy when the same function is used
    // inside the fan-out closure (TS would otherwise widen `schema.execute`
    // back to `T | undefined`).
    if (!schema.execute) {
      emit(node.id, {
        status: "error",
        error: `Node "${node.kind}" has no execute() — every registered schema must.`,
        hash: nodeHash,
      });
      for (const n of topo.order) {
        if (records.get(n.id)?.status === "pending") {
          emit(n.id, { status: "cancelled" });
        }
      }
      return { ok: false, failedNodeId: node.id, records };
    }
    const execute = schema.execute;

    /* ─────────────────────── Fan-out branch ─────────────────────── */
    if (fanOut !== undefined) {
      const { handle: fanHandle, items } = fanOut;
      emit(node.id, {
        status: "running",
        hash: nodeHash,
        fanOut: { total: items.length, done: 0 },
      });
      const start = performance.now();
      const outputsByIndex: Array<
        StandardizedOutput | StandardizedOutput[]
      > = new Array(items.length);
      let doneCount = 0;
      let firstError: unknown;
      let cancelled = false;

      // Bounded-concurrency runner. Stays simple because we don't need
      // priorities or cancellation-of-individual-children — abort kills
      // the whole run by signal.
      let nextIndex = 0;
      async function worker(): Promise<void> {
        for (;;) {
          if (firstError !== undefined || cancelled || signal.aborted) {
            return;
          }
          const i = nextIndex++;
          if (i >= items.length) return;
          const perItemInputs = { ...inputs, [fanHandle]: items[i]! };
          try {
            const rawResult = await execute({
              nodeId: node.id,
              config: node.config,
              inputs: perItemInputs,
              signal,
            });
            const { output: perItemOutput } =
              normalizeExecuteResult(rawResult);
            outputsByIndex[i] = perItemOutput;
            doneCount += 1;
            // Progress emit. We re-read the in-progress record so other
            // metadata (hash) stays stable.
            emit(node.id, {
              status: "running",
              hash: nodeHash,
              fanOut: { total: items.length, done: doneCount },
            });
          } catch (err) {
            if (signal.aborted || (err as Error)?.name === "AbortError") {
              cancelled = true;
              return;
            }
            // First failure wins; remaining workers bail.
            if (firstError === undefined) firstError = err;
            return;
          }
        }
      }

      const workers = Array.from(
        { length: Math.max(1, Math.min(maxConcurrent, items.length)) },
        () => worker(),
      );
      await Promise.all(workers);

      if (cancelled) {
        emit(node.id, { status: "cancelled", hash: nodeHash });
        for (const n of topo.order) {
          if (records.get(n.id)?.status === "pending") {
            emit(n.id, { status: "cancelled" });
          }
        }
        return { ok: false, records };
      }
      if (firstError !== undefined) {
        const message =
          firstError instanceof Error
            ? firstError.message
            : String(firstError);
        emit(node.id, {
          status: "error",
          error: message,
          hash: nodeHash,
        });
        for (const n of topo.order) {
          if (records.get(n.id)?.status === "pending") {
            emit(n.id, { status: "cancelled" });
          }
        }
        return { ok: false, failedNodeId: node.id, records };
      }

      // Flatten N outputs into a single array — each per-item execute
      // may return a single StandardizedOutput or an array; concat
      // both shapes. Skips holes (from early returns).
      const flatOutput: StandardizedOutput[] = [];
      for (const piece of outputsByIndex) {
        if (Array.isArray(piece)) flatOutput.push(...piece);
        else if (piece !== undefined) flatOutput.push(piece);
      }

      const elapsedMs = Math.round(performance.now() - start);
      // Cache the aggregated output (no usage block in fan-out today —
      // the wrapper-level usage on per-item results is dropped because
      // the queue panel shows one row per node, not per-item).
      cache.set(nodeHash, { output: flatOutput });
      outputs.set(node.id, flatOutput);
      emit(node.id, {
        status: "done",
        output: flatOutput,
        elapsedMs,
        hash: nodeHash,
        fanOut: { total: items.length, done: items.length },
      });
      continue;
    }

    /* ───────────────────── Single-execution branch ───────────────────── */
    emit(node.id, { status: "running", hash: nodeHash });
    const start = performance.now();
    try {
      const rawResult = await execute({
        nodeId: node.id,
        config: node.config,
        inputs,
        signal,
      });
      const { output, usage } = normalizeExecuteResult(rawResult);
      const elapsedMs = Math.round(performance.now() - start);
      cache.set(nodeHash, { output, usage });
      outputs.set(node.id, output);
      emit(node.id, {
        status: "done",
        output,
        elapsedMs,
        hash: nodeHash,
        ...(usage ? { usage } : {}),
      });
    } catch (err) {
      // AbortError from inside `execute()` → cancelled, not error.
      if (signal.aborted || (err as Error)?.name === "AbortError") {
        emit(node.id, { status: "cancelled", hash: nodeHash });
        // Mark every still-pending node as cancelled and bail.
        for (const n of topo.order) {
          if (records.get(n.id)?.status === "pending") {
            emit(n.id, { status: "cancelled" });
          }
        }
        return { ok: false, records };
      }
      const message = err instanceof Error ? err.message : String(err);
      emit(node.id, { status: "error", error: message, hash: nodeHash });
      // Everything downstream of the failure stays pending — surface it as
      // cancelled in the UI so it doesn't look like the engine forgot them.
      for (const n of topo.order) {
        if (records.get(n.id)?.status === "pending") {
          emit(n.id, { status: "cancelled" });
        }
      }
      return { ok: false, failedNodeId: node.id, records };
    }
  }

  return { ok: true, records };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Result normalisation                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Both legal return shapes from `execute()` collapse into the same
 * `{ output, usage? }` pair before we touch the cache or emit a record.
 *
 *   StandardizedOutput   ({ type, value })        → { output: it, usage: undefined }
 *   StandardizedOutput[] (array of those)         → { output: [...], usage: undefined }
 *   { output, usage? }                            → unchanged
 *
 * Recognised by structural duck-typing: arrays are arrays;
 * StandardizedOutputs have a `type` discriminator; the rich form has an
 * `output` field. No brand / tag required — nodes can build the rich
 * shape with a plain object literal.
 */
function normalizeExecuteResult(result: NodeExecuteResult): {
  output: StandardizedOutput | StandardizedOutput[];
  usage?: NodeUsage;
} {
  if (Array.isArray(result)) return { output: result };

  // StandardizedOutput discriminator: a `type` field. Check this BEFORE
  // the rich shape so a future StandardizedOutput variant that happens
  // to spell a field "output" wouldn't be misclassified.
  if (
    typeof result === "object" &&
    result !== null &&
    "type" in result &&
    typeof (result as { type: unknown }).type === "string"
  ) {
    return { output: result as StandardizedOutput };
  }

  // Rich shape: must carry `output`. We reject `{ output: undefined }`
  // explicitly — silently storing nothing would be the worst failure
  // mode (downstream nodes would see "no input" with no error trail).
  if (
    typeof result === "object" &&
    result !== null &&
    "output" in result &&
    (result as NodeOutputWithUsage).output !== undefined
  ) {
    const rich = result as NodeOutputWithUsage;
    return { output: rich.output, usage: rich.usage };
  }

  // Anything else is a bug — surface loudly rather than guessing.
  throw new Error(
    "execute() returned an unrecognised result shape: expected a StandardizedOutput, an array, or { output, usage? }.",
  );
}
