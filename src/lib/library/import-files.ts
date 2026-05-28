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

/**
 * Media (video/audio) import caps (Slice C). Larger than images because a
 * song or a driving clip is naturally heavier, but still under common
 * bucket limits. Seedance's own per-file caps (30 MB image / 50 MB video /
 * 15 MB audio total) are enforced separately at generation time.
 */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
export const ACCEPTED_VIDEO_MIME = /^video\//;
export const ACCEPTED_AUDIO_MIME = /^audio\//;

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

/**
 * Import video / audio files (Slice C). Mirrors `importImageFiles`: MIME +
 * size policy in one place, returns the same result shape. `kind` picks the
 * accepted MIME + size cap + the asset-store creator.
 */
export async function importMediaFiles(
  files: File[],
  kind: "video" | "audio",
): Promise<ImportResult> {
  const createMediaAssetFromFile =
    useAssetStore.getState().createMediaAssetFromFile;
  const acceptMime =
    kind === "video" ? ACCEPTED_VIDEO_MIME : ACCEPTED_AUDIO_MIME;
  const maxBytes = kind === "video" ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
  const maxLabel = kind === "video" ? "100 MB" : "30 MB";

  const errors: string[] = [];
  const ids: string[] = [];

  for (const file of files) {
    if (!acceptMime.test(file.type)) {
      errors.push(`${file.name}: not ${kind === "video" ? "a video" : "an audio file"}`);
      continue;
    }
    if (file.size > maxBytes) {
      errors.push(`${file.name}: too large (max ${maxLabel})`);
      continue;
    }
    try {
      const id = await createMediaAssetFromFile(file, kind);
      ids.push(id);
    } catch (err) {
      errors.push(
        `${file.name}: ${err instanceof Error ? err.message : "failed to import"}`,
      );
    }
  }

  return { created: ids.length, errors, ids };
}

/**
 * Same as `importImageFiles` but also wraps the successful imports in a
 * named `AssetGroup` (Slice 5.6, ADR-0032). Returns the group id along
 * with the per-file result.
 *
 * If all files fail to import, the group is still NOT created (an
 * empty group would be an immediate-cleanup target by the cleanup rule
 * — pointless). The caller can detect this by `created === 0` and
 * surface a toast instead of opening the library subview.
 *
 * `isUntitled` defaults to `false` because users hitting this path
 * went through the "Import as group" dialog with an explicit name —
 * it's a real group worth keeping. The `auto-Untitled` flow lives in
 * Slice 5.6d's drop dispatcher (multi-id drag from the library to the
 * canvas creates an Untitled group automatically).
 */
export async function importImageFilesAsGroup(
  files: File[],
  name: string,
): Promise<ImportResult & { groupId: string | null }> {
  const result = await importImageFiles(files);
  if (result.created === 0) {
    return { ...result, groupId: null };
  }
  const groupId = useAssetStore.getState().createGroup({
    name: name.trim() || "Untitled",
    assetIds: result.ids,
    isUntitled: false,
  });
  return { ...result, groupId };
}
