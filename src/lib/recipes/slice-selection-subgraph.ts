import { autoDetectExposedIO } from "@/lib/recipes/auto-detect-io";
import type { RecipeExposedHandle } from "@/lib/repositories/recipe-repository";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * Selection-subgraph slicer (extracted from `save-from-canvas.ts` so the
 * assistant can reuse it for analysis without going through the save path).
 *
 * Given a selection of node ids and the canvas's full edge list, produce
 * everything downstream code needs to reason about the slice as a unit:
 *
 *   - **`nodes`**: the selected nodes (in canvas order).
 *   - **`internalEdges`**: edges where BOTH endpoints are inside the
 *     selection. These travel with the slice if it's saved as a recipe.
 *   - **`boundaryIncoming`**: edges whose `target` is inside but `source`
 *     is outside — what the slice's external dependencies look like.
 *   - **`boundaryOutgoing`**: edges whose `source` is inside but `target`
 *     is outside — what the slice publishes to the rest of the canvas.
 *   - **`exposedInputs` / `exposedOutputs`**: results of `autoDetectExposedIO`
 *     — the public I/O surface if the slice were saved as a recipe.
 *   - **`topologicalOrder`**: id list in dependency order (Kahn's
 *     algorithm over `internalEdges`). Cycles fall back to insertion order.
 *   - **`kindCounts`**: histogram of node kinds (e.g. `{ text: 8, "llm-text": 3 }`)
 *     for one-line summaries in the assistant's knowledge bundle.
 *
 * Pure function — takes the inputs explicitly so callers can pass either
 * the live store snapshot or a hypothetical slice (tests, "what if we
 * dropped node X" scenarios).
 */

export interface SubgraphSlice {
  nodes: NodeInstance[];
  internalEdges: WorkflowEdge[];
  boundaryIncoming: WorkflowEdge[];
  boundaryOutgoing: WorkflowEdge[];
  exposedInputs: RecipeExposedHandle[];
  exposedOutputs: RecipeExposedHandle[];
  topologicalOrder: string[];
  kindCounts: Record<string, number>;
}

export function sliceSelectionSubgraph(
  allNodes: readonly NodeInstance[],
  allEdges: readonly WorkflowEdge[],
  selectedNodeIds: readonly string[],
): SubgraphSlice {
  const selected = new Set(selectedNodeIds);
  const nodes = allNodes.filter((n) => selected.has(n.id));

  // Quick exit on empty selection — keeps the rest of the function
  // free of "is this set empty?" branches.
  if (nodes.length === 0) {
    return {
      nodes: [],
      internalEdges: [],
      boundaryIncoming: [],
      boundaryOutgoing: [],
      exposedInputs: [],
      exposedOutputs: [],
      topologicalOrder: [],
      kindCounts: {},
    };
  }

  const internalEdges: WorkflowEdge[] = [];
  const boundaryIncoming: WorkflowEdge[] = [];
  const boundaryOutgoing: WorkflowEdge[] = [];
  for (const edge of allEdges) {
    const srcIn = selected.has(edge.source);
    const tgtIn = selected.has(edge.target);
    if (srcIn && tgtIn) internalEdges.push(edge);
    else if (!srcIn && tgtIn) boundaryIncoming.push(edge);
    else if (srcIn && !tgtIn) boundaryOutgoing.push(edge);
  }

  const { inputs: exposedInputs, outputs: exposedOutputs } =
    autoDetectExposedIO(nodes, allEdges);

  const topologicalOrder = topoSort(nodes, internalEdges);

  const kindCounts: Record<string, number> = {};
  for (const n of nodes) {
    kindCounts[n.kind] = (kindCounts[n.kind] ?? 0) + 1;
  }

  return {
    nodes,
    internalEdges,
    boundaryIncoming,
    boundaryOutgoing,
    exposedInputs,
    exposedOutputs,
    topologicalOrder,
    kindCounts,
  };
}

/**
 * Kahn's algorithm over the internal-edge set.
 *
 * Returns ids in dependency order: every edge points "earlier → later".
 * Nodes with no internal incoming edges go first. Cycles (which the
 * engine forbids at run-time but might appear in malformed slices) get
 * appended in their original selection order so callers always get a
 * complete list — never throw from a read-only helper.
 */
function topoSort(
  nodes: readonly NodeInstance[],
  edges: readonly WorkflowEdge[],
): string[] {
  const ids = nodes.map((n) => n.id);
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) {
    indegree.set(id, 0);
    outgoing.set(id, []);
  }
  for (const e of edges) {
    if (!indegree.has(e.target) || !outgoing.has(e.source)) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    outgoing.get(e.source)!.push(e.target);
  }

  // Use insertion order (ids[]) for deterministic tie-breaks: when two
  // nodes both have indegree 0, the one earlier in the selection wins.
  const queue: string[] = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const nextDeg = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDeg);
      if (nextDeg <= 0) queue.push(next);
    }
  }

  // Append any cycle members in original order so the result still lists
  // every selected id (the consumer can detect cycles by comparing
  // `order.length` to `ids.length`).
  for (const id of ids) {
    if (!visited.has(id)) order.push(id);
  }

  return order;
}
