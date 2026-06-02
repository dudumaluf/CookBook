/**
 * handle-external-files-drop
 *
 * Glue between an OS file drop / clipboard paste and the canvas. Takes
 * a raw `File[]`, classifies each, runs the existing Library import
 * pipeline (`importImageFiles` / `importMediaFiles`) so storage upload,
 * size caps, MIME filtering, and toast batching all live in one place,
 * then spawns one canvas node per imported asset using the same
 * `assetToNode` mapping the Library drag flow already uses.
 *
 * Pure-ish: stores are read through default getters but every
 * dependency is injectable so tests don't need to spin up Zustand or
 * Supabase. The only side effect on the real path is the `addNode`
 * calls — every node id is returned so the caller can update
 * selection / focus / toast text.
 *
 * The result envelope intentionally separates `imported` (assets
 * created in the Library) from `spawned` (nodes added to the canvas).
 * They are equal on the happy path but can diverge if an asset is
 * created but its id can't be resolved on this tab (e.g. an unrelated
 * race), and we want callers to be able to surface either number
 * without re-counting.
 */

import { assetToNode } from "@/lib/library/asset-to-node";
import { classifyDroppedFile } from "@/lib/library/classify-file";
import {
  importImageFiles,
  importMediaFiles,
  type ImportResult,
} from "@/lib/library/import-files";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { Asset } from "@/types/asset";

export interface HandleExternalFilesDropParams {
  /** Files dropped or pasted onto the canvas. */
  files: File[];
  /** Flow-coordinate position where the first node should land. */
  position: { x: number; y: number };
  /** Per-spawned-node fan-out offset; defaults to +24/+24 (matches the
   *  Library asset drop / Gallery drop conventions). */
  offsetPerNode?: { dx: number; dy: number };

  /* ─── Test hooks (default to real implementations) ─── */
  importImage?: (files: File[]) => Promise<ImportResult>;
  importMedia?: (
    files: File[],
    kind: "video" | "audio",
  ) => Promise<ImportResult>;
  getAssetById?: (id: string) => Asset | undefined;
  addNode?: (
    kind: string,
    position: { x: number; y: number },
    initialConfig?: Record<string, unknown>,
  ) => string;
}

export interface HandleExternalFilesDropResult {
  /** Newly-spawned canvas nodes, in spawn order. */
  spawned: { id: string; kind: string }[];
  /** How many Library assets were successfully created. */
  imported: number;
  /** Per-file rejection reasons (already user-facing strings). */
  errors: string[];
  /** How many files were classified as `unsupported` and skipped
   *  before any import was attempted. */
  skipped: number;
}

/**
 * Import dropped files into the Library and spawn one canvas node per
 * imported asset. The canvas wiring (canvas-flow.tsx) calls this from
 * its `onDrop` handler when `dataTransfer.files` is non-empty and
 * none of the in-app drag MIMEs claimed the event.
 */
export async function handleExternalFilesDrop(
  params: HandleExternalFilesDropParams,
): Promise<HandleExternalFilesDropResult> {
  const {
    files,
    position,
    offsetPerNode = { dx: 24, dy: 24 },
    importImage = importImageFiles,
    importMedia = importMediaFiles,
    getAssetById,
    addNode,
  } = params;

  if (files.length === 0) {
    return { spawned: [], imported: 0, errors: [], skipped: 0 };
  }

  const images: File[] = [];
  const videos: File[] = [];
  const audios: File[] = [];
  let skipped = 0;
  for (const file of files) {
    const kind = classifyDroppedFile(file);
    if (kind === "image") images.push(file);
    else if (kind === "video") videos.push(file);
    else if (kind === "audio") audios.push(file);
    else skipped += 1;
  }

  const orderedIds: string[] = [];
  const errors: string[] = [];
  const collect = (r: ImportResult) => {
    orderedIds.push(...r.ids);
    errors.push(...r.errors);
  };

  // Import order matches the user's grouping intuition: images first,
  // then videos, then audio. Each batch goes through the existing
  // Library pipeline so MIME / size policy stays in one place.
  if (images.length > 0) collect(await importImage(images));
  if (videos.length > 0) collect(await importMedia(videos, "video"));
  if (audios.length > 0) collect(await importMedia(audios, "audio"));

  const lookup =
    getAssetById ??
    ((id: string) =>
      useAssetStore.getState().assets.find((a) => a.id === id));
  const add = addNode ?? useWorkflowStore.getState().addNode;

  const spawned: { id: string; kind: string }[] = [];
  for (let i = 0; i < orderedIds.length; i += 1) {
    const assetId = orderedIds[i]!;
    const asset = lookup(assetId);
    if (!asset) continue;
    const { kind, initialConfig } = assetToNode(asset);
    const nodeId = add(
      kind,
      {
        x: position.x + i * offsetPerNode.dx,
        y: position.y + i * offsetPerNode.dy,
      },
      initialConfig,
    );
    if (nodeId) spawned.push({ id: nodeId, kind });
  }

  return {
    spawned,
    imported: orderedIds.length,
    errors,
    skipped,
  };
}
