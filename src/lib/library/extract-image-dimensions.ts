/**
 * Slice 5.6.2 — measure a `File`'s pixel dimensions before upload.
 *
 * Used by `uploadImageAsset` so the resulting `ImageAsset` carries
 * `width / height` from day one. Future renders can then build CSS
 * `aspect-ratio` directly from the asset record, no `<img onLoad>`
 * dance required.
 *
 * Implementation: blob URL → off-screen `Image` element → wait for
 * `load` (or `error`) → read `naturalWidth / naturalHeight` →
 * revoke the blob URL → resolve.
 *
 * Defensive: any failure path resolves to `null` instead of rejecting.
 * The upload pipeline must NOT block on a failed measurement —
 * "upload but with no dimensions" is strictly better than "no upload
 * at all because we couldn't read dimensions".
 *
 * Browser-only. The canonical caller (`uploadImageAsset`) already
 * runs client-side (it uses the Supabase browser client + the
 * publishable key), so this helper sits in the same client-only
 * tree. Server contexts (Next API routes) shouldn't import this.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

export async function extractImageDimensions(
  file: File,
): Promise<ImageDimensions | null> {
  // Sanity check: only image/* files. Caller already filters in
  // `import-files.ts`, but this is the safest place to bail too.
  if (!file.type.startsWith("image/")) return null;

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    function cleanup() {
      // Revoke ASAP so we don't leak the object URL between cycles.
      URL.revokeObjectURL(url);
      img.onload = null;
      img.onerror = null;
    }

    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      cleanup();
      // Defensive: 0×0 happens for malformed images. Treat as no signal.
      if (width <= 0 || height <= 0) {
        resolve(null);
        return;
      }
      resolve({ width, height });
    };

    img.onerror = () => {
      cleanup();
      resolve(null);
    };

    img.src = url;
  });
}
