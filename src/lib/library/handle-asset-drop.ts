/**
 * Slice 5.6.1 — extracted from `canvas-flow.tsx#onDrop`.
 *
 * Takes a parsed asset-drag payload + a resolved drop target +
 * a canvas position, runs `dispatchAssetDrop` and applies the
 * resulting actions to the workflow + asset stores. Pure-glue:
 * the dispatcher decides WHAT to do (action descriptors); this
 * helper does the workflow / asset store mutations.
 *
 * Two call sites share this:
 *  - `canvas-flow.tsx#onDrop` — top-level drop on the canvas pane
 *    (asset hits the canvas root, not a node).
 *  - `node-image-iterator.tsx` body wrapper — drop directly on an
 *    iterator's surface. Using the same helper guarantees the same
 *    semantics regardless of which surface caught the event.
 *
 * Why the iterator's body needs its own listener instead of relying
 * on the canvas root: HTML5 drag/drop events do bubble, but React
 * Flow's pane internals (specifically the way it renders nodes
 * inside a positioned wrapper) make `dragover` / `drop` on a node
 * not propagate cleanly to the root in some browsers. Mounting the
 * listeners directly on the iterator's body solves this — it's the
 * smallest change with the most predictable behaviour.
 */

import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { AssetDragPayload } from "@/lib/library/asset-drag";
import {
  dispatchAssetDrop,
  type DropTarget,
} from "@/lib/library/dispatch-asset-drop";
import { assetToNode } from "@/lib/library/asset-to-node";

export interface HandleAssetDropOptions {
  payload: AssetDragPayload;
  target?: DropTarget;
  /**
   * Where on the canvas the drop landed (in flow coordinates). Used
   * for spawned nodes' positions; ignored for `append-to-group`
   * actions (those don't spawn anything).
   */
  position: { x: number; y: number };
}

/**
 * Run the dispatcher + apply each action. Side-effecting (writes to
 * stores), but order is deterministic — multi-soul-id drops spawn N
 * nodes offset by 24 px each.
 */
export function handleAssetDrop({
  payload,
  target,
  position,
}: HandleAssetDropOptions): void {
  const actions = dispatchAssetDrop({ payload, target });

  const ws = useWorkflowStore.getState();
  const assetStore = useAssetStore.getState();

  let spawnIndex = 0;
  for (const action of actions) {
    if (action.type === "spawn-node") {
      // For image / soul-id spawns we round-trip through assetToNode so
      // the node lands with the canonical { url } / { customReferenceId,
      // … } config. For image-iterator spawns we trust the dispatcher's
      // initialConfig — it already carries the groupId.
      let initialConfig = action.initialConfig;
      if (
        (action.kind === "image" || action.kind === "soul-id") &&
        typeof initialConfig.assetId === "string"
      ) {
        const asset = assetStore.getAsset(initialConfig.assetId);
        if (asset) initialConfig = assetToNode(asset).initialConfig;
      }
      ws.addNode(
        action.kind,
        {
          x: position.x + spawnIndex * 24,
          y: position.y + spawnIndex * 24,
        },
        initialConfig,
      );
      spawnIndex++;
    } else if (action.type === "create-group-and-spawn-iterator") {
      // (Not currently emitted by the dispatcher post-Slice 5.6.1, but
      // kept as a code path for any future caller — e.g. an explicit
      // "Spawn iterator from these" action.)
      const newGroupId = assetStore.createGroup({
        assetIds: action.assetIds,
        isUntitled: action.isUntitled,
        scope: "project",
      });
      ws.addNode(
        "image-iterator",
        {
          x: position.x + spawnIndex * 24,
          y: position.y + spawnIndex * 24,
        },
        { groupId: newGroupId, cursor: 0, selectionMode: "all" },
      );
      spawnIndex++;
    } else if (action.type === "append-to-group") {
      // Propagate the dropped ids into the iterator's linked group.
      // Two cases: a raw image-id list, or a single sentinel
      // "@group:<id>" emitted by the asset-group → iterator branch
      // of the dispatcher (5.6d). The sentinel needs expansion
      // through the asset store before addToGroup.
      const expandedIds: string[] = [];
      for (const id of action.assetIds) {
        if (typeof id === "string" && id.startsWith("@group:")) {
          const sourceGroupId = id.slice("@group:".length);
          const sourceGroup = assetStore.getAsset(sourceGroupId);
          if (sourceGroup?.kind === "asset-group") {
            expandedIds.push(...sourceGroup.assetIds);
          }
        } else {
          expandedIds.push(id);
        }
      }
      if (expandedIds.length > 0) {
        assetStore.addToGroup(action.groupId, expandedIds);
      }
    }
    // "noop" → fall through; nothing to do.
  }
}
