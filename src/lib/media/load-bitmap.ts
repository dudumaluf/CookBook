/**
 * Cross-origin-safe media byte loader (ADR-0087) — the single source of truth
 * for "give me the bytes / an `ImageBitmap` for this URL" across every
 * browser-side media op (Resize Image, the compositors, the Composer).
 *
 * Why this isn't just `fetch`: a plain cross-origin `fetch` is blocked unless
 * the host returns CORS headers. Supabase's Storage CDN intermittently serves
 * a cached, CORS-header-less response (warmed by the `<img>` preview), and
 * external CDNs (fal, CloudFront, Higgsfield) send no CORS at all — so the
 * picture *displays* via `<img>` while `fetch` dies with `net::ERR_FAILED`
 * ("Failed to fetch"). That surfaced as a "Failed to fetch" error on the
 * Resize Image node.
 *
 * Strategy: try the direct `fetch` first (fast path for same-origin +
 * CORS-friendly hosts — no extra hop), then transparently fall back to the
 * same-origin `/api/proxy-media` relay, which fetches the bytes server-side
 * (no CORS in play) and streams them back from our own origin.
 */

const PROXY_PATH = "/api/proxy-media";

/** Same-origin proxy URL that relays the bytes of a (cross-origin) media URL. */
export function proxiedMediaUrl(url: string): string {
  return `${PROXY_PATH}?url=${encodeURIComponent(url)}`;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Fetch media bytes as a `Blob`. Tries the direct cross-origin `fetch` first,
 * then transparently falls back to the same-origin `/api/proxy-media` relay
 * when the direct fetch is CORS-blocked ("Failed to fetch") or otherwise
 * fails. Aborts propagate untouched.
 */
export async function fetchMediaBlob(url: string): Promise<Blob> {
  let direct: Response | undefined;
  try {
    direct = await fetch(url, { credentials: "omit" });
    if (direct.ok) return await direct.blob();
  } catch (err) {
    if (isAbortError(err)) throw err;
    // CORS / network failure (TypeError "Failed to fetch") — fall through.
  }

  const viaProxy = await fetch(proxiedMediaUrl(url), { credentials: "omit" });
  if (!viaProxy.ok) {
    const status = direct?.status ?? viaProxy.status;
    throw new Error(`Failed to load media (${status}) — ${url}`);
  }
  return await viaProxy.blob();
}

/**
 * Decode a (possibly cross-origin) image URL into an `ImageBitmap`. Single
 * `url` argument by design so it stays a drop-in for `urls.map(loadBitmap)`.
 */
export async function loadBitmap(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await fetchMediaBlob(url));
}
