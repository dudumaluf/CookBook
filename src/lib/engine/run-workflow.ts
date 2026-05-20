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
 * Run the workflow once.
 *
 * Slice 3.1 contract:
 *   - Strict topological order, serial execution (no parallelism).
 *   - Cycles → every node marked `error` with a "cycle detected" message.
 *   - For each node in order:
 *       1. Resolve its inputs by reading the outputs of upstream nodes
 *          (collected from edges). Handles with no incoming edge get
 *          `undefined`. Multi-input handles get an array.
 *       2. Compute a content hash from `{ kind, config, deps }`.
 *       3. If the cache already has that hash, emit `cached` with the
 *          previous output.
 *       4. Otherwise emit `running`, await `execute()`, store the output
 *          in the cache, emit `done`. Time the call so the UI can show
 *          how long the node took.
 *       5. On `execute()` throw: emit `error` and stop. Downstream nodes
 *          stay `pending` (which the store then upgrades to `cancelled`
 *          for clarity in the UI).
 *   - On `signal.aborted` between nodes: stop early; everything not yet
 *     finished becomes `cancelled`.
 *
 * Parallelism, retries, partial re-runs, and persistent caches are all
 * later slices (3.x). Keeping this loop dead simple is the whole point —
 * it's where the most surprises hide.
 */
export async function runWorkflow(
  opts: RunWorkflowOptions,
): Promise<RunWorkflowResult> {
  const { nodes, edges, registry, cache, onProgress, signal } = opts;
  const records = new Map<string, ExecutionRecord>();

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
  for (const n of topo.order) emit(n.id, { status: "pending" });

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
    const inputs: Record<
      string,
      StandardizedOutput | StandardizedOutput[] | undefined
    > = {};
    // Upstream hashes per target handle, to feed `computeNodeHash`.
    const upstreamHashesByTargetHandle = new Map<string, string[]>();
    for (const edge of edgesByTarget.get(node.id) ?? []) {
      const upstreamOutput = outputs.get(edge.source);
      const upstreamHash = hashes.get(edge.source);
      if (upstreamOutput === undefined || upstreamHash === undefined) {
        // Upstream errored / cancelled / not yet run — skip this edge.
        // Downstream node's execute() will see `undefined` for this handle
        // and decide whether that's acceptable.
        continue;
      }
      const handleInputs = inputs[edge.targetHandle];
      // Compose multi-input handles into arrays; single-input keeps the
      // most recent (the workflow-store rejects 2nd edges into single
      // inputs, so this branch only matters for `multiple:true` handles).
      const isMulti =
        schema.inputs.find((i) => i.id === edge.targetHandle)?.multiple ??
        false;
      if (isMulti) {
        const arr = Array.isArray(handleInputs)
          ? handleInputs
          : handleInputs
            ? [handleInputs]
            : [];
        // The output of an upstream is itself a single or an array; flatten.
        if (Array.isArray(upstreamOutput)) arr.push(...upstreamOutput);
        else arr.push(upstreamOutput);
        inputs[edge.targetHandle] = arr;
      } else {
        // Single — keep the first upstream encountered (workflow-store
        // ensures there's only one).
        inputs[edge.targetHandle] = upstreamOutput;
      }
      const hashBucket =
        upstreamHashesByTargetHandle.get(edge.targetHandle) ?? [];
      hashBucket.push(upstreamHash);
      upstreamHashesByTargetHandle.set(edge.targetHandle, hashBucket);
    }

    const nodeHash = computeNodeHash(node, upstreamHashesByTargetHandle);
    hashes.set(node.id, nodeHash);

    // Cache hit?
    const cached = cache.get(nodeHash);
    if (cached !== undefined) {
      outputs.set(node.id, cached.output);
      emit(node.id, {
        status: "cached",
        output: cached.output,
        hash: nodeHash,
        // Replay the original usage block so the cumulative run total
        // in the Queue panel credits the cached saving correctly.
        ...(cached.usage ? { usage: cached.usage } : {}),
      });
      continue;
    }

    // Cache miss — run.
    emit(node.id, { status: "running", hash: nodeHash });
    const start = performance.now();
    try {
      const execute = schema.execute;
      if (!execute) {
        throw new Error(
          `Node "${node.kind}" has no execute() — every registered schema must.`,
        );
      }
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
