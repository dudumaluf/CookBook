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

export function buildObjectKey(filename: string): string {
  return `images/${randomKey()}/${sanitizeFilename(filename)}`;
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
  const key = buildObjectKey(file.name);

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
