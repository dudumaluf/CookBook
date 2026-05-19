/**
 * Drag-and-drop contract between AssetCard (library) and CanvasFlow (canvas).
 *
 * We use HTML5 DnD with a custom MIME type so dragging files from the OS or
 * URLs from other apps don't accidentally trigger our asset-drop handler.
 */

import type { AssetKind } from "@/types/asset";

export const ASSET_DRAG_MIME = "application/x-cookbook-asset";

export interface AssetDragPayload {
  assetId: string;
  /** Echoed for early bail-out before reading the store. */
  kind: AssetKind;
}

export function serializeAssetDrag(payload: AssetDragPayload): string {
  return JSON.stringify(payload);
}

export function parseAssetDrag(raw: string): AssetDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "assetId" in parsed &&
      "kind" in parsed &&
      typeof (parsed as AssetDragPayload).assetId === "string" &&
      typeof (parsed as AssetDragPayload).kind === "string"
    ) {
      return parsed as AssetDragPayload;
    }
    return null;
  } catch {
    return null;
  }
}
