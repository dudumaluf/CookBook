import { useAssetStore } from "@/lib/stores/asset-store";

/**
 * Shared file-import pipeline.
 *
 * Both the NewAssetPopover and the LibraryContent drop zone import files
 * through this helper so policy (MIME filtering, size cap, scope, toast
 * batching) stays in one place.
 *
 * The 25 MB cap is conservative for an MVP: it keeps Supabase uploads
 * snappy on slower connections, sits comfortably under the bucket's 30 MB
 * server-side limit, and is easy to relax once we have image-resize on
 * import.
 */

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_IMAGE_MIME = /^image\//;

export interface ImportResult {
  /** Number of assets successfully created. */
  created: number;
  /** Per-file rejection reasons (already user-facing). */
  errors: string[];
  /** Asset ids in creation order — useful for selecting / focusing later. */
  ids: string[];
}

export async function importImageFiles(files: File[]): Promise<ImportResult> {
  const createImageAssetFromFile =
    useAssetStore.getState().createImageAssetFromFile;

  const errors: string[] = [];
  const ids: string[] = [];

  for (const file of files) {
    if (!ACCEPTED_IMAGE_MIME.test(file.type)) {
      errors.push(`${file.name}: not an image`);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      errors.push(`${file.name}: too large (max 25 MB)`);
      continue;
    }
    try {
      const id = await createImageAssetFromFile(file);
      ids.push(id);
    } catch (err) {
      errors.push(
        `${file.name}: ${err instanceof Error ? err.message : "failed to import"}`,
      );
    }
  }

  return { created: ids.length, errors, ids };
}
