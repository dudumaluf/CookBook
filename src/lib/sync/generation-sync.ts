"use client";

import { nodeRegistry } from "@/lib/engine/registry";
import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";
import {
  uploadAudioFromUrl,
  uploadImageFromUrl,
  uploadVideoFromUrl,
} from "@/lib/library/upload-asset";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type {
  ExecutionRecord,
  NodeCategory,
  NodeUsage,
  StandardizedOutput,
} from "@/types/node";

/**
 * Slice 6.5 — Gallery is a curated corpus, not a sink for every node's
 * output. Only AI-generation categories make it into `cookbook_generations`
 * (the user paid for these; they're worth durable storage + searching +
 * pinning + showing in Gallery). Inputs (Text/Image/Number/Soul ID),
 * iterators, transforms (Array/List), and outputs (Export) are skipped —
 * their values flow through the engine but never persist.
 *
 * Add a category to this set when a new generation node lands (e.g. video
 * gen via Higgsfield video). Categories live in `src/types/node.ts`.
 */
const GALLERY_CATEGORIES: ReadonlySet<NodeCategory> = new Set([
  "ai-text",
  "ai-image",
  "ai-video",
] as const);

/**
 * generation-sync — Slice 6.2 (ADR-0035).
 *
 * Subscribes to the execution-store. When a node record transitions to
 * `done` with output, this layer:
 *
 *   1. **Auto-rehosts external image URLs** — Higgsfield's CloudFront /
 *      Fal's CDN URLs aren't user-owned and may expire. Download bytes,
 *      re-upload to our `cookbook-assets` bucket under
 *      `users/<uid>/images/<random>/...`, swap the URL.
 *
 *   2. **Inserts a `cookbook_generations` row** with the (rehosted)
 *      output, usage, prompt text, and node metadata. Source of truth
 *      for the Gallery + per-node history cursor.
 *
 *   3. **Patches `execution-store.records[nodeId].output`** with the
 *      rehosted URLs so the body / queue panel render canonical URLs
 *      instead of CDN ones. The cache is untouched (still has CDN URL —
 *      cache key is content-hashed, so a re-run still hits cache; but
 *      rehost runs again per session).
 *
 * **Cached records do NOT generate rows.** A cache hit isn't a new
 * generation — same hash means same output, already persisted on the
 * first run. Filter `record.status === "done"` only.
 *
 * Idempotency: each `done` emit produces exactly one row (or N rows if
 * the output is an array — Higgsfield batch_size=4 = 4 rows). Re-running
 * the same workflow yields a fresh row per `done` emit (different
 * `created_at` + `run_id`), which is correct — the user explicitly ran
 * it again.
 *
 * Failures are logged but not thrown — losing one Gallery row beats
 * crashing the run.
 */

const SUPABASE_BUCKET_HOST_HINT = "supabase.";

function isExternalUrl(url: string): boolean {
  // Heuristic: anything not pointing at our Supabase project's bucket.
  // We don't have the exact host string at build-time without an env var,
  // but Supabase Storage URLs all carry `supabase.` in the hostname. CDN
  // origins (cloudfront, fal.media, etc.) won't.
  if (!url) return false;
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  return !url.includes(SUPABASE_BUCKET_HOST_HINT);
}

interface RehostedOutputResult {
  output: StandardizedOutput | StandardizedOutput[];
  rehosted: boolean;
}

/**
 * Walk a node's output (single or array), rehosting any image / video /
 * audio URL that isn't already on our bucket (Slice A generalized this from
 * image-only). Returns the new output + a flag indicating whether at least
 * one URL was swapped.
 */
async function rehostExternalMediaIfNeeded(
  output: StandardizedOutput | StandardizedOutput[],
  nodeKind: string,
): Promise<RehostedOutputResult> {
  const isArray = Array.isArray(output);
  const list = isArray ? output : [output];
  let didAny = false;
  const remapped: StandardizedOutput[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i]!;
    const isMedia =
      item.type === "image" || item.type === "video" || item.type === "audio";
    if (!isMedia || !item.value.url || !isExternalUrl(item.value.url)) {
      remapped.push(item);
      continue;
    }
    try {
      if (item.type === "image") {
        const up = await uploadImageFromUrl(
          item.value.url,
          `${nodeKind}-${i + 1}.png`,
        );
        remapped.push({ type: "image", value: { ...item.value, url: up.url } });
      } else if (item.type === "video") {
        const up = await uploadVideoFromUrl(
          item.value.url,
          `${nodeKind}-${i + 1}.mp4`,
        );
        remapped.push({ type: "video", value: { ...item.value, url: up.url } });
      } else {
        const up = await uploadAudioFromUrl(
          item.value.url,
          `${nodeKind}-${i + 1}.mp3`,
        );
        remapped.push({ type: "audio", value: { ...item.value, url: up.url } });
      }
      didAny = true;
    } catch (err) {
      // Rehost failed — keep the original CDN URL. UI continues working
      // until that URL expires. Log so we can debug recurring failures.
      console.warn(
        "[generation-sync] rehost failed for",
        item.value.url,
        err,
      );
      remapped.push(item);
    }
  }
  return {
    output: isArray ? remapped : remapped[0]!,
    rehosted: didAny,
  };
}

/**
 * Best-effort prompt extraction. ExecutionRecord doesn't carry the
 * inputs map today (engine-internal), so we walk the live workflow
 * graph: find an edge into the node's `prompt` handle, look up the
 * upstream's record, pull its text output. Good enough for "search
 * Gallery by prompt" — null is fine when the heuristic misses.
 */
function extractPromptForNode(nodeId: string): string | null {
  const w = useWorkflowStore.getState();
  const promptEdge = w.edges.find(
    (e) => e.target === nodeId && e.targetHandle === "prompt",
  );
  if (!promptEdge) return null;
  const upstreamRecord = useExecutionStore
    .getState()
    .records.get(promptEdge.source);
  const out = upstreamRecord?.output;
  if (!out) return null;
  const single = Array.isArray(out) ? out[0] : out;
  if (!single || single.type !== "text") return null;
  return String(single.value);
}

function patchRecordOutput(
  nodeId: string,
  newOutput: StandardizedOutput | StandardizedOutput[],
): void {
  const records = new Map(useExecutionStore.getState().records);
  const prev = records.get(nodeId);
  if (!prev) return;
  records.set(nodeId, { ...prev, output: newOutput });
  useExecutionStore.setState({ records });
}

/* ──────────────────── Wiring ──────────────────── */

/**
 * Persist a single `done` record. Idempotent at the level of "one row
 * per call" — caller controls dedup (we hook the subscriber on
 * `done` transitions only, never on `cached`).
 */
async function persistRecord(
  nodeId: string,
  record: ExecutionRecord,
  context: { projectId: string; ownerId: string; runId: number },
): Promise<void> {
  if (record.output === undefined) return;
  const node = useWorkflowStore
    .getState()
    .nodes.find((n) => n.id === nodeId);
  if (!node) return; // Node was deleted mid-run — skip.

  // Slice 6.5 — Gallery whitelist. Skip Text/Number/Soul ID/Array/List/
  // Iterators/Export — their outputs flow through the engine but the
  // Gallery is reserved for paid AI generations only.
  const schema = nodeRegistry.get(node.kind);
  if (!schema || !GALLERY_CATEGORIES.has(schema.category)) return;

  // Step 1: rehost external image URLs to our bucket (best-effort).
  const { output: rehostedOutput, rehosted } =
    await rehostExternalMediaIfNeeded(record.output, node.kind);

  // Step 2: patch the live record so UI starts using canonical URLs.
  if (rehosted) {
    patchRecordOutput(nodeId, rehostedOutput);
  }

  // Step 3: insert the row. Multi-output (e.g. Higgsfield batch=4) writes
  // one row per item — easier for Gallery to query/filter than nested.
  const repo = getGenerationRepository();
  const items = Array.isArray(rehostedOutput)
    ? rehostedOutput
    : [rehostedOutput];
  const promptText = extractPromptForNode(nodeId);
  for (const item of items) {
    try {
      await repo.insert({
        projectId: context.projectId,
        ownerId: context.ownerId,
        nodeId,
        nodeKind: node.kind,
        runId: context.runId,
        output: item,
        usage: (record.usage as NodeUsage | undefined) ?? null,
        promptText,
      });
    } catch (err) {
      console.warn("[generation-sync] insert failed for", nodeId, err);
    }
  }
}

interface AutoPersistOptions {
  ownerId: string;
}

/**
 * Subscribe to execution-store records and auto-persist every `done`
 * transition. Returns an unsubscribe function for teardown on logout.
 *
 * Diff strategy: keep a snapshot of last-seen statuses; on every store
 * mutation, find nodes whose status flipped to `done` since last check
 * and queue persistence. Dedup per (nodeId, runId) so a record being
 * re-emitted (e.g. status flicker) doesn't insert twice.
 */
// Module-level singleton guard + shared dedup set. Two failure modes this
// kills: (1) the shell effect re-subscribing (StrictMode double-invoke, a
// `user` identity change, remount) would otherwise stack N subscribers, each
// inserting once -> N duplicate rows per run. (2) Even a single subscriber
// re-firing for the same (runId, nodeId) is deduped here. The seen set is
// keyed by (runId, nodeId) so each fresh run still persists (new runId).
let activeUnsubscribe: (() => void) | null = null;
const seenPersisted = new Set<string>();

export function startAutoPersistGenerations({
  ownerId,
}: AutoPersistOptions): () => void {
  // Singleton: tear down any prior subscription before adding a new one, so
  // there is never more than one active subscriber (no double inserts).
  if (activeUnsubscribe) {
    activeUnsubscribe();
    activeUnsubscribe = null;
  }
  const seen = seenPersisted;
  function key(nodeId: string, runId: number): string {
    return `${runId}::${nodeId}`;
  }
  const rawUnsubscribe = useExecutionStore.subscribe((state) => {
    const projectId = useProjectStore.getState().id;
    if (!projectId) return; // No project loaded yet.
    const runId = state.runId;
    for (const [nodeId, record] of state.records) {
      if (record.status !== "done") continue;
      if (record.output === undefined) continue;
      const k = key(nodeId, runId);
      if (seen.has(k)) continue;
      seen.add(k);
      void persistRecord(nodeId, record, {
        projectId,
        ownerId,
        runId,
      });
    }
  });
  const unsubscribe = () => {
    rawUnsubscribe();
    if (activeUnsubscribe) activeUnsubscribe = null;
  };
  activeUnsubscribe = unsubscribe;
  return unsubscribe;
}

/* ──────────────────── Tests-only helpers ──────────────────── */

export const _internals = {
  isExternalUrl,
  rehostExternalMediaIfNeeded,
  extractPromptForNode,
  /** Test-only: clear the module-level singleton + dedup state. */
  resetForTests: () => {
    if (activeUnsubscribe) activeUnsubscribe();
    activeUnsubscribe = null;
    seenPersisted.clear();
  },
};
