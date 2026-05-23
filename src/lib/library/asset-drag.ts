/**
 * Drag-and-drop contract between AssetCard (library) and CanvasFlow (canvas).
 *
 * We use HTML5 DnD with a custom MIME type so dragging files from the OS or
 * URLs from other apps don't accidentally trigger our asset-drop handler.
 *
 * Slice 5.5c: payload grows from a single `{ assetId, kind }` to a multi
 * `{ assetIds: string[], kind }`. A 1-asset drag still uses a 1-element
 * array so the parser has a single shape to read. The legacy single-id
 * shape is still accepted by `parseAssetDrag` for back-compat with any
 * in-flight tests / persisted state.
 */

import type { AssetKind } from "@/types/asset";

export const ASSET_DRAG_MIME = "application/x-cookbook-asset";

export interface AssetDragPayload {
  /** All selected asset ids dragged together. Always a non-empty array. */
  assetIds: string[];
  /** Echoed for early bail-out before reading the store. All ids share the kind. */
  kind: AssetKind;
}

export function serializeAssetDrag(payload: AssetDragPayload): string {
  return JSON.stringify(payload);
}

export function parseAssetDrag(raw: string): AssetDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    const kind = obj.kind;
    if (typeof kind !== "string") return null;

    // New (Slice 5.5c) multi shape.
    if (Array.isArray(obj.assetIds)) {
      const assetIds = obj.assetIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      if (assetIds.length === 0) return null;
      return { assetIds, kind: kind as AssetKind };
    }

    // Legacy single-id shape (pre-5.5c) — promote to a 1-element array.
    if (typeof obj.assetId === "string" && obj.assetId.length > 0) {
      return { assetIds: [obj.assetId], kind: kind as AssetKind };
    }

    return null;
  } catch {
    return null;
  }
}
