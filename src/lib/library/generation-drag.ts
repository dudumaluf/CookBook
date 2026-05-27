/**
 * Drag-and-drop contract from Gallery cards / lightbox to the canvas
 * (Slice 6.5).
 *
 * Parallel to `asset-drag.ts` — different MIME, different payload, but
 * the same handler shape on the canvas side. We carry the resolved
 * outputs in the payload (rather than just generation ids) so the
 * canvas can spawn nodes synchronously without an extra repository
 * round-trip; for image generations this means the spawned `image`
 * node is wired with the `{ url }` config the moment it lands.
 *
 * Multi-select drag carries every selected card's payload — N image
 * generations selected → N spawned image nodes, offset by 24px each.
 */

import type { StandardizedOutput } from "@/types/node";

export const GENERATION_DRAG_MIME = "application/x-cookbook-generation";

export interface GenerationDragItem {
  generationId: string;
  output: StandardizedOutput;
}

export interface GenerationDragPayload {
  /** Always non-empty; one entry per selected card at drag start. */
  items: GenerationDragItem[];
}

export function serializeGenerationDrag(
  payload: GenerationDragPayload,
): string {
  return JSON.stringify(payload);
}

export function parseGenerationDrag(
  raw: string,
): GenerationDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.items)) return null;
    const items = obj.items.filter((item): item is GenerationDragItem => {
      if (typeof item !== "object" || item === null) return false;
      const it = item as Record<string, unknown>;
      if (typeof it.generationId !== "string" || it.generationId.length === 0)
        return false;
      const out = it.output as { type?: unknown } | undefined;
      if (!out || typeof out.type !== "string") return false;
      return true;
    });
    if (items.length === 0) return null;
    return { items };
  } catch {
    return null;
  }
}
