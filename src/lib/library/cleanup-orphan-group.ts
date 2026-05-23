/**
 * Slice 5.6e — bridge between the workflow store (knows which iterators
 * link to which groups) and the asset store (knows the group's
 * `isUntitled` flag). Pure-glue: walks the workflow store nodes,
 * computes the linked-iterator set for `groupId`, and asks the asset
 * store to drop the group iff it's an unreferenced Untitled.
 *
 * Idempotent: harmless on `groupId === ""`, deleted groups, non-
 * Untitled groups (the asset store's `cleanupUntitledGroupIfOrphan`
 * no-ops in those cases too).
 *
 * Callers: `canvas-flow.tsx#onDrop` after a node removal that touched
 * an iterator — i.e. our keyboard-Delete path AND React Flow's
 * dimensions/remove change emitter (third-party API delete in dev,
 * not user-driven today but kept for completeness).
 */

import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

export function cleanupGroupIfOrphan(groupId: string): void {
  if (typeof groupId !== "string" || groupId.length === 0) return;
  const linked = useWorkflowStore
    .getState()
    .nodes.filter((n) => {
      if (n.kind !== "image-iterator") return false;
      const cfg = (n.config ?? {}) as { groupId?: unknown };
      return typeof cfg.groupId === "string" && cfg.groupId === groupId;
    })
    .map((n) => n.id);
  useAssetStore.getState().cleanupUntitledGroupIfOrphan(groupId, linked);
}
