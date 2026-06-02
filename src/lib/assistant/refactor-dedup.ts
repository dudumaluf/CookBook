import type { RefactorOperation } from "@/lib/assistant/refactor-types";

type RemoveEdgeOperation = Extract<RefactorOperation, { op: "remove_edge" }>;

/**
 * Pure helper that strips cascade-redundant `remove_edge` ops from a
 * proposed batch.
 *
 * Why:
 *   The workflow store's `removeNode(id)` cascades — every edge with
 *   that node as source or target is removed at the same time. So when
 *   a proposal includes `remove_node X` followed by `remove_edge Y`
 *   (where Y is incident to X), Y is already gone by the time the
 *   batch executor reaches the explicit op, the executor flags the
 *   missing edge, and the whole batch rolls back.
 *
 *   The batch executor (`refactor-apply.ts`) now treats those
 *   cascade-driven misses as success, so the failure mode is fixed.
 *   This helper is the *cosmetic* counterpart: the modal preview no
 *   longer surfaces the redundant ops, so the user reads "9 changes
 *   queued" → "8 changes queued" matching what actually runs.
 *
 * Signature:
 *   - `operations`: the proposal as the LLM emitted it.
 *   - `existingEdges`: the canvas snapshot used to look up which edges
 *     are incident to the node ids being removed. Pass `[]` if the
 *     caller doesn't have a snapshot — in that case dedup degrades to
 *     a no-op (we can only filter ops we can prove are redundant).
 *
 * The helper is order-preserving: ops that survive the filter come
 * back in the same order. Cross-op `add_node` clientId references and
 * the executor's removed-node tracking continue to work unchanged.
 *
 * NOT covered here (intentional):
 *   - Edges added by an earlier `add_edge` in the same proposal that
 *     reference a clientId. Those don't have a real edge id yet, so
 *     they can't be `remove_edge` targets.
 *   - Self-redundant ops (e.g. `remove_edge` repeated). The batch
 *     executor's idempotency handles those at apply time; filtering
 *     them here would cost a Set lookup per op for no preview win.
 */

export interface DedupEdgeSnapshot {
  id: string;
  source: string;
  target: string;
}

export interface DedupResult {
  operations: RefactorOperation[];
  /** Ops we removed because they were cascade-redundant. Useful for
   *  toast/log copy ("3 redundant edge removals filtered"). */
  removed: RemoveEdgeOperation[];
}

export function dedupCascadeRedundantOps(
  operations: readonly RefactorOperation[],
  existingEdges: readonly DedupEdgeSnapshot[],
): DedupResult {
  if (existingEdges.length === 0) {
    // Without a snapshot we can't prove redundancy. Pass through.
    return { operations: [...operations], removed: [] };
  }
  const edgeIndex = new Map<string, DedupEdgeSnapshot>();
  for (const e of existingEdges) edgeIndex.set(e.id, e);

  const kept: RefactorOperation[] = [];
  const removed: RemoveEdgeOperation[] = [];
  const removedNodeIds = new Set<string>();

  for (const op of operations) {
    if (op.op === "remove_node") {
      removedNodeIds.add(op.nodeId);
      kept.push(op);
      continue;
    }
    if (op.op === "remove_edge") {
      const edge = edgeIndex.get(op.edgeId);
      if (
        edge &&
        (removedNodeIds.has(edge.source) || removedNodeIds.has(edge.target))
      ) {
        removed.push(op);
        continue;
      }
    }
    kept.push(op);
  }

  return { operations: kept, removed };
}
