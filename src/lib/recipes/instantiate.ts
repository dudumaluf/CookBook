import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type {
  NodeInstance,
  WorkflowEdge,
} from "@/types/node";

import type { RecipeSubgraph } from "@/lib/repositories/recipe-repository";

/**
 * instantiateRecipeOnCanvas — Slice 6.4.
 *
 * Expands a recipe's stored subgraph onto the live workflow canvas as
 * fresh nodes (with new ids and translated positions). Returns the new
 * node ids for callers that want to select / focus them.
 *
 * ID mapping:
 *  - Each saved node gets a fresh `id` (uuid-ish) so it doesn't collide
 *    with any existing canvas node.
 *  - Edges' `source` / `target` are remapped from saved ids to fresh ones.
 *  - Saved positions are translated by `position` so the spawn lands at
 *    a chosen anchor (e.g. drop coordinates, viewport center).
 *
 * The canvas state (workflow-store) gains the new nodes + edges
 * atomically — this is intentionally one mutation cycle so React Flow
 * sees them all in the same render.
 *
 * Composite mode (`isNode: true` recipes) is NOT handled here — that's
 * the M0d composite-runtime concern. For Slice 6.4 we always expand.
 */

interface InstantiateOptions {
  subgraph: RecipeSubgraph;
  /** Anchor point for the top-left of the spawned subgraph. */
  position: { x: number; y: number };
}

interface InstantiateResult {
  nodeIds: string[];
}

function makeId(): string {
  // Same shape the workflow-store uses for fresh ids — short, unique
  // enough for our scale, no external dep needed.
  return `node_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

export function instantiateRecipeOnCanvas({
  subgraph,
  position,
}: InstantiateOptions): InstantiateResult {
  const idMap = new Map<string, string>();
  for (const node of subgraph.nodes) {
    idMap.set(node.id, makeId());
  }

  // Compute the saved subgraph's top-left so we can translate it to the
  // user's anchor. Empty graph → translate from origin (no-op).
  const minX =
    subgraph.nodes.length > 0
      ? Math.min(...subgraph.nodes.map((n) => n.position.x))
      : 0;
  const minY =
    subgraph.nodes.length > 0
      ? Math.min(...subgraph.nodes.map((n) => n.position.y))
      : 0;
  const dx = position.x - minX;
  const dy = position.y - minY;

  const newNodes: NodeInstance[] = subgraph.nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id)!,
    position: {
      x: node.position.x + dx,
      y: node.position.y + dy,
    },
  }));

  const newEdges: WorkflowEdge[] = subgraph.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((edge) => ({
      ...edge,
      id: makeId(),
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
    }));

  // Atomic mutation — workflow-store doesn't expose `addNodes(...)`
  // batched today, but `setState` from outside is safe and mirrors how
  // project-sync hydrates from cloud.
  useWorkflowStore.setState((state) => ({
    nodes: [...state.nodes, ...newNodes],
    edges: [...state.edges, ...newEdges],
  }));

  return { nodeIds: newNodes.map((n) => n.id) };
}
