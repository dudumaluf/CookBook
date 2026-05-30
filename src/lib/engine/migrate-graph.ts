import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * Forward-port graph-level shapes that span nodes + edges (ADR-0056).
 *
 * Pure + registry-free so it can run from BOTH persistence funnels: the
 * workflow-store `persist` migrate (local rehydrate) AND
 * `applyProjectDocument` (cloud / file load, which bypasses persist).
 */

const MIN_CLIP_PORTS = 2;

/**
 * Video Concat moved from one `clips` multi-handle to ordered `clip-0..N`
 * sockets. Rewrite any edge still targeting `clips` to the next indexed
 * socket (in edge order) and set the node's `portCount` so the sockets
 * render. No-op when there's nothing to migrate.
 */
export function migrateVideoConcatClips(
  nodes: NodeInstance[],
  edges: WorkflowEdge[],
): { nodes: NodeInstance[]; edges: WorkflowEdge[] } {
  const concatIds = new Set(
    nodes.filter((n) => n.kind === "video-concat").map((n) => n.id),
  );
  if (concatIds.size === 0) return { nodes, edges };

  const counters = new Map<string, number>();
  let changed = false;
  const nextEdges = edges.map((e) => {
    if (concatIds.has(e.target) && e.targetHandle === "clips") {
      const i = counters.get(e.target) ?? 0;
      counters.set(e.target, i + 1);
      changed = true;
      return { ...e, targetHandle: `clip-${i}` };
    }
    return e;
  });
  if (!changed) return { nodes, edges };

  const nextNodes = nodes.map((n) => {
    if (n.kind !== "video-concat") return n;
    const count = counters.get(n.id) ?? 0;
    const cfg = (n.config ?? {}) as Record<string, unknown>;
    return {
      ...n,
      config: { ...cfg, portCount: Math.max(MIN_CLIP_PORTS, count + 1) },
    };
  });
  return { nodes: nextNodes, edges: nextEdges };
}
