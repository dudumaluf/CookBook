/**
 * Upload images / video / audio to Supabase Storage and return a
 * `remote`-source descriptor ready to attach to a new asset.
 *
 * **Object keys are content-addressed** (ADR-0083):
 * `users/<uid>/<folder>/<sha256>.<ext>`. Hashing the bytes means identical
 * content always maps to the same key, so re-running a transform or
 * rehosting the same generation twice stores the bytes exactly once — a
 * duplicate upload comes back as a 409 we treat as success (the object is
 * already there). This is the "same image / same video → don't re-save"
 * guarantee, enforced at the storage layer for every upload path.
 *
 * When Web Crypto is unavailable (non-secure context / some test runners)
 * we fall back to the legacy random key (`<folder>/<random>/<filename>`)
 * via `buildObjectKey` — correctness over dedup, with no collision risk.
 *
 * The bucket is `public: true` so `getPublicUrl()` returns a CDN-cacheable
 * URL with no signed-URL ceremony. Writes are scoped under
 * `users/<auth.uid>/` so RLS authorizes them (ADR-0034); the upload happens
 * directly from the browser using the publishable (anon) key.
 */

import { getAssetsBucket, getSupabaseClient } from "@/lib/supabase/client";

import { extractImageDimensions } from "./extract-image-dimensions";

export interface UploadedImageDescriptor {
  bucket: string;
  key: string;
  url: string;
  mime: string;
  sizeBytes: number;
  /**
   * Image pixel dimensions captured BEFORE upload via an off-screen
   * `Image` element (Slice 5.6.2). Stored on the resulting
   * `ImageAsset` so node previews can render with the correct
   * `aspect-ratio` from day one — no `<img onLoad>` flicker.
   *
   * Optional because `extractImageDimensions` resolves to `null` on
   * malformed images / non-image MIMEs (rather than blocking the
   * upload). When omitted, downstream renderers fall back to the
   * `<img onLoad>` measurement path.
   */
  width?: number;
  height?: number;
}

/** Strip / replace anything that's not safe in a storage object key. */
function sanitizeFilename(name: string): string {
  // Keep only ASCII letters, digits, dot, dash, underscore. Replace runs of
  // anything else with a single dash, collapse repeats, and clean up
  // leading dots (path-traversal-ish) / trailing dashes / dashes
  // immediately before the extension dot.
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/-+\./g, ".")
    .replace(/^[.\-_]+/, "")
    .replace(/-+$/, "");
  return ascii.length > 0 ? ascii.slice(0, 128) : "upload";
}

function randomKey(): string {
  // 8 hex chars from crypto.getRandomValues — collision risk is fine at our
  // expected volumes and we'd notice quickly anyway (upload would 409).
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * SHA-256 (lowercase hex) of a blob's bytes via Web Crypto. Returns `null`
 * when `crypto.subtle` is unavailable — only the case in a non-secure
 * context or a bare test runner; the browser always has it on https /
 * localhost. A null result makes the caller fall back to a random key
 * (legacy behavior, no dedup) rather than risk a weak-hash collision that
 * could alias two different images onto one object.
 */
async function contentHashHex(blob: Blob): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Pick a file extension for the content-addressed key. Prefer the original
 * filename's extension (so `.jpg` stays `.jpg`), then the MIME subtype,
 * then the folder-specific fallback. Lowercased; `jpeg` is normalized to
 * `jpg`.
 */
function extensionFor(filename: string, mime: string, fallback: string): string {
  const fromName = /\.([a-zA-Z0-9]{1,8})$/.exec(filename.trim())?.[1];
  if (fromName) return fromName.toLowerCase() === "jpeg" ? "jpg" : fromName.toLowerCase();
  const fromMime = mime.split("/")[1]?.toLowerCase().replace(/^jpeg$/, "jpg");
  return fromMime && /^[a-z0-9]{1,8}$/.test(fromMime) ? fromMime : fallback;
}

/** Build a content-addressed key: `users/<uid>/<folder>/<hash>.<ext>`. */
function buildContentKey(
  folder: "images" | "videos" | "audio",
  hash: string,
  ext: string,
  userId?: string,
): string {
  const base = `${folder}/${hash}.${ext}`;
  return userId ? `users/${userId}/${base}` : base;
}

/**
 * True when a Storage upload failed only because the object already exists
 * (`upsert: false` + a key collision). For content-addressed keys that's
 * not an error — it means the exact same bytes are already stored, so we
 * treat it as a successful dedup and reuse the existing object. Covers the
 * couple of error shapes Supabase Storage has used across versions.
 */
function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    message?: unknown;
    error?: unknown;
    statusCode?: unknown;
    status?: unknown;
  };
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (msg.includes("already exists") || msg.includes("duplicate")) return true;
  if (e.error === "Duplicate") return true;
  return e.statusCode === 409 || e.statusCode === "409" || e.status === 409;
}

/**
 * Build the canonical object key for an image upload.
 *
 * Slice 6.1 (ADR-0034) prepends a per-user folder so RLS can scope writes
 * to `users/<auth.uid()>/...`. Pass the authenticated user's id; the
 * caller (`uploadImageAsset`) reads it from `getSupabaseClient().auth.getUser()`
 * just before upload so the prefix is always current.
 *
 * Pre-Slice-6.1 keys look like `images/<random>/<filename>` — those are
 * grandfathered (still readable via public URL because the bucket is
 * `public: true`), but every NEW upload from now on lands under the user's
 * folder.
 */
export function buildObjectKey(filename: string, userId?: string): string {
  return buildMediaObjectKey("images", filename, userId);
}

/**
 * Generalized object-key builder (Slice A). Same shape as `buildObjectKey`
 * but with an explicit top-level folder so video / audio land in their own
 * namespaces (`videos/...`, `audio/...`) instead of `images/...`.
 */
export function buildMediaObjectKey(
  folder: "images" | "videos" | "audio",
  filename: string,
  userId?: string,
): string {
  const base = `${folder}/${randomKey()}/${sanitizeFilename(filename)}`;
  if (!userId) return base;
  return `users/${userId}/${base}`;
}

/**
 * Upload a single file to the assets bucket. Throws on failure with a
 * user-readable message — the import pipeline catches and surfaces it as
 * a toast error.
 */
export async function uploadImageAsset(
  file: File,
): Promise<UploadedImageDescriptor> {
  const supabase = getSupabaseClient();
  const bucket = getAssetsBucket();
  // Slice 6.1 — user-scoped key. RLS rejects writes outside `users/<uid>/`.
  // We tolerate `auth.getUser()` returning null (e.g. in tests / future
  // anonymous mode) by falling back to the legacy unscoped key. Real
  // production writes always have a user.
  const userId = (await supabase.auth.getUser()).data.user?.id;

  // Capture pixel dimensions + hash the bytes BEFORE the network
  // round-trip. Dimensions ship `width / height` on the resulting
  // `ImageAsset` (Slice 5.6.2); the hash content-addresses the key so
  // identical bytes dedup (ADR-0083). Failures on dimensions resolve to
  // `null` and the upload continues — "uploaded with no dimensions" beats
  // "no upload at all".
  const [dimensions, hash] = await Promise.all([
    extractImageDimensions(file),
    contentHashHex(file),
  ]);
  const key = hash
    ? buildContentKey("images", hash, extensionFor(file.name, file.type, "png"), userId)
    : buildObjectKey(file.name, userId); // legacy random key (no Web Crypto)

  const { error } = await supabase.storage.from(bucket).upload(key, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "31536000", // 1y; objects are immutable per key
    upsert: false,
  });
  // A 409 on a content-addressed key just means these exact bytes are
  // already stored — reuse them (dedup) instead of failing.
  if (error && !isAlreadyExistsError(error)) {
    throw new Error(error.message || "Supabase upload failed");
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  if (!data.publicUrl) {
    throw new Error("Supabase returned no public URL for the upload");
  }

  return {
    bucket,
    key,
    url: data.publicUrl,
    mime: file.type || "application/octet-stream",
    sizeBytes: file.size,
    ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
  };
}

/**
 * Download a remote image URL into our own bucket (Slice 4.5 — Export node).
 *
 * Used when the user wants to "save" generated images: the gen node
 * returned a CloudFront URL hosted by the upstream provider (Higgsfield,
 * Fal, etc.); to keep the asset durable and unblock future projects /
 * recipes, we re-host it under our own bucket. Returns the same descriptor
 * shape as `uploadImageAsset` so the asset-store can persist it as a
 * `remote`-source asset.
 *
 * Filename derivation: the last path segment of the URL, sanitised,
 * with a `.png` fallback when the URL has no extension.
 */
export async function uploadImageFromUrl(
  url: string,
  filenameHint?: string,
): Promise<UploadedImageDescriptor> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${url}: HTTP ${res.status}`,
    );
  }
  const blob = await res.blob();
  const mime = blob.type || res.headers.get("content-type") || "image/png";

  // Pull a filename hint out of the URL path tail; fall back to a generic.
  const fallback =
    filenameHint ||
    url.split("?")[0]!.split("/").pop() ||
    "generated.png";
  const ensureExt = /\.(png|jpe?g|webp|gif|avif)$/i.test(fallback)
    ? fallback
    : `${fallback}.png`;

  // Wrap in a File so we can reuse `uploadImageAsset`'s exact upload shape.
  const file = new File([blob], ensureExt, { type: mime });
  return uploadImageAsset(file);
}

/**
 * Descriptor for an uploaded video / audio file (Slice A). Same `remote`
 * shape as images minus pixel dimensions (media carries duration instead,
 * which the consuming node probes separately via `probeMedia`).
 */
export interface UploadedMediaDescriptor {
  bucket: string;
  key: string;
  url: string;
  mime: string;
  sizeBytes: number;
}

const MEDIA_EXT_FALLBACK: Record<"videos" | "audio", string> = {
  videos: "mp4",
  audio: "mp3",
};

/**
 * Upload a media File (video / audio) to the assets bucket. Mirrors
 * `uploadImageAsset` but writes under the `videos/` or `audio/` folder and
 * skips image-dimension extraction.
 */
export async function uploadMediaAsset(
  file: File,
  folder: "videos" | "audio",
): Promise<UploadedMediaDescriptor> {
  const supabase = getSupabaseClient();
  const bucket = getAssetsBucket();
  const userId = (await supabase.auth.getUser()).data.user?.id;

  // Content-address the key off the bytes so identical media dedups
  // (ADR-0083); fall back to a random key when Web Crypto is unavailable.
  const hash = await contentHashHex(file);
  const key = hash
    ? buildContentKey(
        folder,
        hash,
        extensionFor(file.name, file.type, MEDIA_EXT_FALLBACK[folder]),
        userId,
      )
    : buildMediaObjectKey(folder, file.name, userId);

  const { error } = await supabase.storage.from(bucket).upload(key, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error && !isAlreadyExistsError(error)) {
    throw new Error(error.message || "Supabase upload failed");
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  if (!data.publicUrl) {
    throw new Error("Supabase returned no public URL for the upload");
  }

  return {
    bucket,
    key,
    url: data.publicUrl,
    mime: file.type || "application/octet-stream",
    sizeBytes: file.size,
  };
}

/**
 * Re-host a remote media URL (video / audio) into our bucket (Slice A).
 * Used to make Fal/Seedance CDN results durable + user-owned, mirroring
 * `uploadImageFromUrl`. `folder` picks the namespace + extension fallback.
 */
export async function uploadMediaFromUrl(
  url: string,
  folder: "videos" | "audio",
  filenameHint?: string,
): Promise<UploadedMediaDescriptor> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const fallbackExt = MEDIA_EXT_FALLBACK[folder];
  const mime =
    blob.type ||
    res.headers.get("content-type") ||
    (folder === "videos" ? "video/mp4" : "audio/mpeg");

  const fallbackName =
    filenameHint ||
    url.split("?")[0]!.split("/").pop() ||
    `generated.${fallbackExt}`;
  const hasExt = /\.[a-z0-9]{2,4}$/i.test(fallbackName);
  const name = hasExt ? fallbackName : `${fallbackName}.${fallbackExt}`;

  const file = new File([blob], name, { type: mime });
  return uploadMediaAsset(file, folder);
}

/** Convenience wrappers for the two media folders. */
export function uploadVideoFromUrl(
  url: string,
  filenameHint?: string,
): Promise<UploadedMediaDescriptor> {
  return uploadMediaFromUrl(url, "videos", filenameHint);
}

export function uploadAudioFromUrl(
  url: string,
  filenameHint?: string,
): Promise<UploadedMediaDescriptor> {
  return uploadMediaFromUrl(url, "audio", filenameHint);
}

/**
 * Delete an object from the assets bucket. Idempotent enough — Supabase
 * returns success even if the key didn't exist, which is what we want for
 * `removeAsset` (the user doesn't care if cleanup raced something).
 */
export async function deleteAssetObject(
  bucket: string,
  key: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.storage.from(bucket).remove([key]);
  if (error) {
    // Swallow so a single failed cleanup doesn't break the user flow; surface
    // in the console for debugging.
    console.warn("deleteAssetObject failed:", error.message);
  }
}
