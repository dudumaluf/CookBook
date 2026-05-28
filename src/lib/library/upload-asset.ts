/**
 * Upload an image file to Supabase Storage and return a `remote`-source
 * descriptor ready to attach to a new `ImageAsset`.
 *
 * Object keys are content-addressed-ish: `images/<random>/<safe-filename>`.
 * The random prefix collision-proofs concurrent uploads of the same
 * filename; keeping the filename tail makes the bucket browsable in the
 * Supabase dashboard. Switch to a content hash later if we want dedupe.
 *
 * The bucket is `public: true` so `getPublicUrl()` returns a CDN-cacheable
 * URL with no signed-URL ceremony — fine for the MVP, swap for signed URLs
 * when we add auth.
 *
 * The upload happens directly from the browser using the publishable
 * (anon) key. Bucket-scoped INSERT policy is what authorizes it; see
 * supabase migration `cookbook_assets_bucket`.
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
  const { data: userData } = await supabase.auth.getUser();
  const key = buildObjectKey(file.name, userData.user?.id);

  // Capture pixel dimensions BEFORE the network round-trip so the
  // resulting `ImageAsset` ships with `width / height` on day one
  // (Slice 5.6.2). Failures resolve to `null` and the upload
  // continues — "uploaded with no dimensions" is strictly better
  // than "no upload at all because we couldn't measure".
  const dimensions = await extractImageDimensions(file);

  const { error } = await supabase.storage.from(bucket).upload(key, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "31536000", // 1y; objects are immutable per key
    upsert: false,
  });
  if (error) {
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
  const { data: userData } = await supabase.auth.getUser();
  const key = buildMediaObjectKey(folder, file.name, userData.user?.id);

  const { error } = await supabase.storage.from(bucket).upload(key, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) {
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
