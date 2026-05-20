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

export interface UploadedImageDescriptor {
  bucket: string;
  key: string;
  url: string;
  mime: string;
  sizeBytes: number;
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
  };
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
