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

const SEEDANCE_REF_CAPS = { image: 9, video: 3, audio: 3 } as const;
const SEEDANCE_PORT_KEY = {
  image: "imagePorts",
  video: "videoPorts",
  audio: "audioPorts",
} as const;

/**
 * Seedance reference mode moved from single `image`/`video`/`audio`
 * multi-handles to numbered `image-0..N` / `video-0..N` / `audio-0..N`
 * sockets (ADR-0058). Rewrite legacy edges to the indexed sockets (in edge
 * order, capped per type) and set the node's port counts so they render.
 */
export function migrateSeedanceRefHandles(
  nodes: NodeInstance[],
  edges: WorkflowEdge[],
): { nodes: NodeInstance[]; edges: WorkflowEdge[] } {
  const seedanceIds = new Set(
    nodes.filter((n) => n.kind === "seedance-video").map((n) => n.id),
  );
  if (seedanceIds.size === 0) return { nodes, edges };

  // counters[nodeId][base] = how many edges of that base seen so far.
  const counters = new Map<string, { image: number; video: number; audio: number }>();
  let changed = false;
  const nextEdges = edges.map((e) => {
    const base = (["image", "video", "audio"] as const).find(
      (b) => e.targetHandle === b,
    );
    if (!base || !seedanceIds.has(e.target)) return e;
    const c = counters.get(e.target) ?? { image: 0, video: 0, audio: 0 };
    const i = c[base];
    c[base] = i + 1;
    counters.set(e.target, c);
    if (i >= SEEDANCE_REF_CAPS[base]) return e; // beyond cap — leave (will be dropped)
    changed = true;
    return { ...e, targetHandle: `${base}-${i}` };
  });
  if (!changed) return { nodes, edges };

  const nextNodes = nodes.map((n) => {
    if (n.kind !== "seedance-video") return n;
    const c = counters.get(n.id);
    if (!c) return n;
    const cfg = (n.config ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { ...cfg };
    for (const base of ["image", "video", "audio"] as const) {
      if (c[base] > 0) {
        patch[SEEDANCE_PORT_KEY[base]] = Math.min(
          SEEDANCE_REF_CAPS[base],
          c[base],
        );
      }
    }
    return { ...n, config: patch };
  });
  return { nodes: nextNodes, edges: nextEdges };
}

const LLM_TEXT_PORT_CAPS = { user: 8, image: 9 } as const;
const LLM_TEXT_PORT_KEY = {
  user: "userPorts",
  image: "imagePorts",
} as const;

/**
 * LLM Text moved from `user` (multi) + `image` (multi) to numbered
 * `user-0..N` / `image-0..N` sockets that auto-grow as you wire (smart
 * inputs). Rewrite legacy edges to the indexed sockets (in edge order,
 * capped per type) and set the node's `userPorts` / `imagePorts` so the
 * sockets render at their post-migration count.
 *
 * `system` is intentionally untouched — it's still a single port.
 */
export function migrateLlmTextSmartInputs(
  nodes: NodeInstance[],
  edges: WorkflowEdge[],
): { nodes: NodeInstance[]; edges: WorkflowEdge[] } {
  const llmTextIds = new Set(
    nodes.filter((n) => n.kind === "llm-text").map((n) => n.id),
  );
  if (llmTextIds.size === 0) return { nodes, edges };

  const counters = new Map<string, { user: number; image: number }>();
  let changed = false;
  const nextEdges = edges.map((e) => {
    const base = (["user", "image"] as const).find(
      (b) => e.targetHandle === b,
    );
    if (!base || !llmTextIds.has(e.target)) return e;
    const c = counters.get(e.target) ?? { user: 0, image: 0 };
    const i = c[base];
    c[base] = i + 1;
    counters.set(e.target, c);
    if (i >= LLM_TEXT_PORT_CAPS[base]) return e; // beyond cap — leave (will be dropped)
    changed = true;
    return { ...e, targetHandle: `${base}-${i}` };
  });
  if (!changed) return { nodes, edges };

  const nextNodes = nodes.map((n) => {
    if (n.kind !== "llm-text") return n;
    const c = counters.get(n.id);
    if (!c) return n;
    const cfg = (n.config ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { ...cfg };
    for (const base of ["user", "image"] as const) {
      if (c[base] > 0) {
        patch[LLM_TEXT_PORT_KEY[base]] = Math.min(
          LLM_TEXT_PORT_CAPS[base],
          c[base],
        );
      }
    }
    return { ...n, config: patch };
  });
  return { nodes: nextNodes, edges: nextEdges };
}
