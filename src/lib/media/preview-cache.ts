"use client";

/**
 * Render memo for reactive client-side canvas nodes — Image Transform +
 * Image Stack (ADR-0075).
 *
 * These nodes are `reactive: true`, so their preview re-renders live as the
 * user drags a slider or an upstream image changes — WITHOUT an explicit
 * Run. But the reactive runner uses a fresh per-flush cache and re-executes
 * every reactive node on every workflow tick, and a canvas re-encode +
 * Supabase upload on each tick would be slow AND spam storage with orphans.
 *
 * So in preview (reactive) mode these nodes render to a local
 * `URL.createObjectURL` blob instead of uploading, and memo the result here
 * keyed by a content string (config + input urls):
 *
 *  - `renderPreview(nodeId, key, makeBlob)` returns a STABLE `blob:` URL for
 *    the node's current state, re-encoding ONLY when the key changes — so an
 *    unrelated workflow tick is an instant no-op (memo hit) and the node
 *    record doesn't churn.
 *  - `commitDurableRender(nodeId, key, url)` is called by the full-Run path
 *    after it uploads a durable copy, so a subsequent preview tick for the
 *    SAME state reuses the durable URL instead of flipping the record back
 *    to a transient blob (project persistence skips `blob:` URLs).
 *
 * One entry per node (bounded memory). When a node's state changes, its
 * previous blob is revoked — deferred a few seconds so the UI has already
 * swapped to the new URL (avoids a revoked-blob flash). Durable Supabase
 * URLs are never revoked.
 */

interface CachedRender {
  key: string;
  url: string;
  durable: boolean;
}

const byNode = new Map<string, CachedRender>();

/** Deferred so any element still pointing at the old URL has re-rendered. */
const REVOKE_DELAY_MS = 4000;

export function isBlobUrl(url: string | undefined | null): boolean {
  return typeof url === "string" && url.startsWith("blob:");
}

function canUseObjectUrls(): boolean {
  return (
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
  );
}

function revokeLater(url: string): void {
  if (!isBlobUrl(url)) return;
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
    return;
  }
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* best-effort cleanup */
    }
  }, REVOKE_DELAY_MS);
}

/**
 * Return a stable local URL for `nodeId`'s current render `key`, encoding a
 * fresh blob via `makeBlob` only when the key changed since the last call.
 * The previous (blob) render for the node is scheduled for revocation.
 */
export async function renderPreview(
  nodeId: string,
  key: string,
  makeBlob: () => Promise<Blob>,
): Promise<string> {
  const prev = byNode.get(nodeId);
  if (prev && prev.key === key) return prev.url; // unchanged — reuse
  const blob = await makeBlob();
  const url = canUseObjectUrls()
    ? URL.createObjectURL(blob)
    : // Fallback for environments without object URLs (some test runners):
      // a data URL keeps the contract (a usable image src) without leaking.
      await blobToDataUrl(blob);
  if (prev && !prev.durable) revokeLater(prev.url);
  byNode.set(nodeId, { key, url, durable: false });
  return url;
}

/**
 * Record the durable (uploaded) URL produced by a full Run so later preview
 * ticks for the same `key` reuse it instead of re-rendering a transient blob.
 */
export function commitDurableRender(
  nodeId: string,
  key: string,
  url: string,
): void {
  const prev = byNode.get(nodeId);
  if (prev && !prev.durable && prev.url !== url) revokeLater(prev.url);
  byNode.set(nodeId, { key, url, durable: true });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");
  return `data:${blob.type || "image/png"};base64,${b64}`;
}

/** Test-only: clear all memo state so module-level cache can't leak across tests. */
export function _resetPreviewRenderCache(): void {
  byNode.clear();
}
