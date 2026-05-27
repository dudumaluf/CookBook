/**
 * Download helpers (Slice 6.5 hotfix).
 *
 * The naive `<a download href="https://..." />` pattern only works for
 * SAME-ORIGIN resources, or when the server sends
 * `Content-Disposition: attachment`. Supabase Storage public URLs are
 * cross-origin, so browsers silently ignore the `download` attribute
 * and navigate to the URL instead — opening the image in a new tab is
 * the symptom we hit.
 *
 * Fix: fetch the resource as a Blob, create a `blob:` URL (which IS
 * same-origin), then trigger the anchor click. The browser honors the
 * `download` attribute on blob URLs and the file lands in Downloads.
 */

/**
 * Sanitize a free-form name into a safe filename slug.
 * - Strips path separators / control characters.
 * - Collapses whitespace to underscores.
 * - Caps length so we don't blow common FS limits.
 */
export function safeFilename(name: string, fallback = "download"): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._\- ]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 96);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Force-download a remote URL as `filename`. Uses fetch+blob so cross-
 * origin URLs (Supabase Storage / CDNs) actually save instead of
 * navigating to a new tab.
 *
 * Returns a promise so callers can sequence multi-downloads with `await`.
 */
export async function downloadFromUrl(
  url: string,
  filename: string,
): Promise<void> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revoke so the browser has a tick to start the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}

/**
 * Force-download an in-memory text payload as `filename`. Same plumbing
 * as `downloadFromUrl` — the Blob path always works because blob URLs
 * are same-origin.
 */
export function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}
