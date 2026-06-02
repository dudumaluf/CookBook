import type { NodeInstance, WorkflowEdge } from "@/types/node";
import { normalizeFalImageModel } from "@/lib/fal/types";

/**
 * Forward-port graph-level shapes that span nodes + edges (ADR-0056).
 *
 * Pure + registry-free so it can run from BOTH persistence funnels: the
 * workflow-store `persist` migrate (local rehydrate) AND
 * `applyProjectDocument` (cloud / file load, which bypasses persist).
 *
 * `@/lib/fal/types` is registry-free too (only zod + tiny constants), so
 * importing `normalizeFalImageModel` doesn't pull in the node registry.
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

/**
 * Per-model max wired image references the Fal Image node accepts in a
 * single call. Sourced from `FAL_IMAGE_MODEL_CAPS` in `src/lib/fal/types.ts`,
 * inlined here so this graph-migration module stays free of UI/type imports
 * (it has to run before the registry is loaded). Keep these in sync with
 * `editRefs.max` / `styleReferences.max` when caps change.
 */
const FAL_IMAGE_MAX_REFS: Record<string, number> = {
  "nano-banana-2": 14,
  "flux-2-pro": 8,
  "seedream-v4.5": 10,
  "krea-v2-medium": 10,
  "krea-v2-large": 10,
};
const FAL_IMAGE_DEFAULT_MODEL = "nano-banana-2";
const FAL_IMAGE_MIN_PORTS = 2;

/**
 * Heal Fal Image node `config.model` values that don't match the runtime
 * registry. Two cases in the wild (2026-06-02):
 *
 * 1. The assistant occasionally writes the Fal endpoint id (e.g.
 *    `"fal-ai/nano-banana-2"`, the value used by `image-api.ts`) instead
 *    of the literal (`"nano-banana-2"`). Pre-fix this would crash the
 *    canvas with `Cannot read properties of undefined (reading 'editRefs')`
 *    because `FAL_IMAGE_MODEL_CAPS["fal-ai/nano-banana-2"]` is undefined.
 * 2. Hand-edited / older project files with a typo or removed model.
 *
 * Both cases are repaired here on load by funnelling the value through
 * {@link normalizeFalImageModel} (strip `fal-ai/` prefix on match, fall
 * back to the default). The next autosave persists the cleaned value.
 *
 * No-op when every fal-image node already has a known model — keeps the
 * migrator cheap on the happy path.
 */
export function migrateFalImageModelNormalization(
  nodes: NodeInstance[],
  edges: WorkflowEdge[],
): { nodes: NodeInstance[]; edges: WorkflowEdge[] } {
  let changed = false;
  const nextNodes = nodes.map((n) => {
    if (n.kind !== "fal-image") return n;
    const cfg = (n.config ?? {}) as { model?: unknown };
    const raw = cfg.model;
    const normalized = normalizeFalImageModel(raw);
    if (raw === normalized) return n;
    changed = true;
    return { ...n, config: { ...cfg, model: normalized } };
  });
  if (!changed) return { nodes, edges };
  return { nodes: nextNodes, edges };
}

/**
 * Fal Image moved from a single `image` (multi) handle to numbered
 * `image-0..N` sockets that auto-grow as you wire (smart inputs). Rewrite
 * any legacy `image` edge to the next indexed socket (in edge order, capped
 * at the per-node model's max) and set the node's `imagePorts` so the
 * sockets render at the right count.
 */
export function migrateFalImageSmartInputs(
  nodes: NodeInstance[],
  edges: WorkflowEdge[],
): { nodes: NodeInstance[]; edges: WorkflowEdge[] } {
  const falImageIds = new Set(
    nodes.filter((n) => n.kind === "fal-image").map((n) => n.id),
  );
  if (falImageIds.size === 0) return { nodes, edges };

  // Pre-compute each node's max refs from its current `config.model`. Stale
  // / unknown models fall back to the default's cap so the migration is
  // deterministic even on hand-edited project files.
  const maxRefsById = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind !== "fal-image") continue;
    const cfg = (n.config ?? {}) as { model?: string };
    const model = cfg.model ?? FAL_IMAGE_DEFAULT_MODEL;
    maxRefsById.set(
      n.id,
      FAL_IMAGE_MAX_REFS[model] ?? FAL_IMAGE_MAX_REFS[FAL_IMAGE_DEFAULT_MODEL]!,
    );
  }

  const counters = new Map<string, number>();
  let changed = false;
  const nextEdges = edges.map((e) => {
    if (e.targetHandle !== "image" || !falImageIds.has(e.target)) return e;
    const i = counters.get(e.target) ?? 0;
    counters.set(e.target, i + 1);
    const cap = maxRefsById.get(e.target) ?? 0;
    if (i >= cap) return e; // beyond cap — leave (will be dropped)
    changed = true;
    return { ...e, targetHandle: `image-${i}` };
  });
  if (!changed) return { nodes, edges };

  const nextNodes = nodes.map((n) => {
    if (n.kind !== "fal-image") return n;
    const count = counters.get(n.id) ?? 0;
    if (count === 0) return n;
    const cfg = (n.config ?? {}) as Record<string, unknown>;
    const cap = maxRefsById.get(n.id) ?? 0;
    // One trailing empty slot above the migrated count, capped at the
    // model's max so we don't render a phantom socket the engine would
    // ignore. Floor at MIN_IMAGE_PORTS so the node never collapses to
    // a single ref slot post-migration.
    const ports = Math.min(cap, Math.max(FAL_IMAGE_MIN_PORTS, count + 1));
    return { ...n, config: { ...cfg, imagePorts: ports } };
  });
  return { nodes: nextNodes, edges: nextEdges };
}

/**
 * LLM Text user prompt is now a single socket (rolled back from the
 * smart-input pattern — combining many user texts is what the Text Concat
 * node is for). The earlier v12 migration split legacy `user` (multi)
 * edges into numbered `user-0..N` sockets; we now collapse those back to
 * a single `user`. Lowest-index `user-N` wins (or first `user` edge if a
 * pre-v12 canvas slipped through somehow); the rest of the user edges
 * are dropped. Also strips any stale `userPorts` from the config so
 * project files don't carry the now-unused field forever.
 */
export function migrateLlmTextCollapseUserPorts(
  nodes: NodeInstance[],
  edges: WorkflowEdge[],
): { nodes: NodeInstance[]; edges: WorkflowEdge[] } {
  const llmTextIds = new Set(
    nodes.filter((n) => n.kind === "llm-text").map((n) => n.id),
  );
  if (llmTextIds.size === 0) return { nodes, edges };

  // Pass 1 — find each node's "winning" user edge by rank. `user`
  // (legacy multi from pre-v12 canvases) ranks 0; `user-0` ranks 1;
  // `user-1` ranks 2; ... ties broken by first encountered.
  const userEdgeRank = (handle: string): number => {
    if (handle === "user") return 0;
    if (handle.startsWith("user-")) {
      const n = Number(handle.slice("user-".length));
      return Number.isFinite(n) ? n + 1 : Number.POSITIVE_INFINITY;
    }
    return Number.POSITIVE_INFINITY;
  };
  const winningId = new Map<string, string>();
  const winningRank = new Map<string, number>();
  for (const e of edges) {
    if (!llmTextIds.has(e.target)) continue;
    const rank = userEdgeRank(e.targetHandle ?? "");
    if (!Number.isFinite(rank)) continue;
    const currentRank = winningRank.get(e.target);
    if (currentRank === undefined || rank < currentRank) {
      winningRank.set(e.target, rank);
      winningId.set(e.target, e.id);
    }
  }

  // Pass 2 — keep each winning edge (renamed to `user` if numbered),
  // drop the rest of the user-related edges. Non-user edges and
  // edges to other nodes pass through untouched.
  let changed = false;
  const nextEdges: WorkflowEdge[] = [];
  for (const e of edges) {
    const isLlmTarget = llmTextIds.has(e.target);
    const handle = e.targetHandle ?? "";
    const isUserHandle = handle === "user" || handle.startsWith("user-");

    if (!isLlmTarget || !isUserHandle) {
      nextEdges.push(e);
      continue;
    }
    if (winningId.get(e.target) !== e.id) {
      changed = true;
      continue;
    }
    if (handle !== "user") {
      changed = true;
      nextEdges.push({ ...e, targetHandle: "user" });
    } else {
      nextEdges.push(e);
    }
  }

  // Strip `userPorts` from llm-text node configs whether or not we
  // touched any edge — the field is meaningless under the new schema
  // and lingering on project documents would just be cruft.
  const nextNodes = nodes.map((n) => {
    if (n.kind !== "llm-text") return n;
    const cfg = (n.config ?? {}) as Record<string, unknown>;
    if (!("userPorts" in cfg)) return n;
    changed = true;
    const next = { ...cfg };
    delete next.userPorts;
    return { ...n, config: next };
  });

  if (!changed) return { nodes, edges };
  return { nodes: nextNodes, edges: nextEdges };
}
