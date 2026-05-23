/**
 * Drop dispatcher (Slice 5.6.1, supersedes Slice 5.6d's N-images branch).
 *
 * Decides what happens when an asset payload from the library lands on
 * the canvas. Pure / framework-agnostic — takes the dispatched payload
 * + the resolved drop context (including the target iterator's
 * resolved `groupId`, if any) and returns a description of the
 * action(s); the caller (`canvas-flow.tsx`'s `onDrop`) is responsible
 * for wiring each action into the right store mutation.
 *
 * The decision tree (post-5.6.1):
 *
 *   1 image asset, dropped on empty canvas
 *      → spawn 1 Image node
 *   1 image asset, dropped on an existing Image Iterator
 *      → `append-to-group` on the iterator's linked group
 *   N (>=2) image assets, dropped on empty canvas
 *      → spawn N Image nodes (one per id), offset slightly
 *        ** Slice 5.6.1 change: was `create-group-and-spawn-iterator`
 *           in Slice 5.6d. The user's expectation is "N drops = N
 *           nodes"; auto-grouping into an iterator was unexpected.
 *           Iterator now requires an explicit group drag. **
 *   N (>=2) image assets, dropped on an existing Image Iterator
 *      → `append-to-group` on the iterator's linked group
 *
 *   1 group asset, dropped on empty canvas
 *      → spawn 1 Image Iterator linked to the group's id
 *        (multiple iterators can share a group — they all become
 *         live views on the same underlying set, which is the
 *         entire point of the AssetGroup model)
 *   1 group asset, dropped on an existing Image Iterator
 *      → `append-to-group` on the target's linked group, using the
 *        SOURCE group's `assetIds` as the payload (merges sets;
 *        does NOT collapse / delete the source group)
 *
 *   Any number of soul-id assets, anywhere
 *      → spawn 1 SoulID node per asset (legacy single-spawn loops)
 *
 *   Drop target is some other existing node (Higgsfield, LLM, …)
 *      → falls through to the "empty canvas" branch (we don't
 *        auto-wire — too magical, and the user might not want that
 *        asset on that node's input handle)
 */

import type { AssetDragPayload } from "./asset-drag";

/** Context the canvas hands to the dispatcher about where the user dropped. */
export interface DropTarget {
  /**
   * Node id whose body / card the drop landed on, if any. The caller
   * is responsible for hit-testing against React Flow's measured node
   * bounds before calling.
   */
  nodeId?: string;
  /** Kind of the node above, if `nodeId` is set. */
  nodeKind?: string;
  /**
   * The iterator's linked group id, if `nodeKind === "image-iterator"`.
   * Resolved by the caller from the workflow store. May be `""` for
   * placeholder iterators that haven't been linked yet (in which case
   * the dispatcher converts the drop into a fresh-spawn instead of an
   * append).
   */
  iteratorGroupId?: string;
}

/**
 * Action descriptor returned to the caller. The caller maps each
 * variant to the appropriate store mutation. Three variants:
 *
 * - `spawn-node` — call `useWorkflowStore.addNode(kind, pos, config)`.
 *   For `image-iterator` spawns triggered by a group-drag, `config`
 *   already carries `groupId` + cursor + selectionMode.
 * - `create-group-and-spawn-iterator` — multi-step: call
 *   `useAssetStore.createGroup({ assetIds, isUntitled: true })` to get
 *   the new group's id, then `useWorkflowStore.addNode("image-iterator",
 *   pos, { groupId, cursor: 0, selectionMode: "all" })`.
 * - `append-to-group` — call `useAssetStore.addToGroup(groupId, ids)`.
 *   The iterator re-renders automatically because it subscribes to the
 *   asset store.
 * - `noop` — defensive fall-through for empty payloads / unsupported
 *   kinds.
 */
export type AssetDropAction =
  | {
      type: "spawn-node";
      kind: string;
      initialConfig: Record<string, unknown>;
    }
  | {
      type: "create-group-and-spawn-iterator";
      assetIds: string[];
      /** `true` for the auto-Untitled groups that drag-of-N-images creates. */
      isUntitled: boolean;
    }
  | {
      type: "append-to-group";
      groupId: string;
      assetIds: string[];
    }
  | { type: "noop"; reason: string };

export interface DispatchAssetDropOptions {
  payload: AssetDragPayload;
  /** Canvas drop target (when the payload landed on a node). */
  target?: DropTarget;
}

export function dispatchAssetDrop({
  payload,
  target,
}: DispatchAssetDropOptions): AssetDropAction[] {
  if (payload.assetIds.length === 0) {
    return [{ type: "noop", reason: "empty-payload" }];
  }

  // Soul ID — never collapses into an iterator. Each id spawns its own
  // node (matches Slice 4 behaviour). N spawns means a 1-action-per-id
  // result; the caller can reduce them sequentially.
  if (payload.kind === "soul-id") {
    return payload.assetIds.map((id) => ({
      type: "spawn-node" as const,
      kind: "soul-id",
      initialConfig: { assetId: id },
    }));
  }

  // ── Drop target lookup ────────────────────────────────────────────────
  // A drop landing on an existing Image Iterator with a real linked
  // group → propagate via `append-to-group`. The iterator with empty
  // groupId (placeholder) doesn't get the propagate path; falls
  // through to the spawn / create branches below so the user gets a
  // working iterator either way.
  const droppedOnIterator =
    target?.nodeKind === "image-iterator" &&
    target.nodeId !== undefined &&
    typeof target.iteratorGroupId === "string" &&
    target.iteratorGroupId.length > 0;

  if (payload.kind === "asset-group") {
    // Drag of a group card. Always 1 group at a time (drag-payload
    // contract — multi-group selection drag could emit multi ids,
    // but spawning N iterators feels overkill until anyone asks for
    // it). The first id is the group's id.
    const sourceGroupId = payload.assetIds[0]!;

    if (droppedOnIterator) {
      // Merge the source group's contents into the target iterator's
      // linked group. We DON'T inline-resolve the source group's
      // assetIds here (the dispatcher is store-agnostic); the caller
      // does the lookup before calling addToGroup. A second action
      // descriptor with the source group's id makes that explicit.
      return [
        {
          type: "append-to-group",
          groupId: target.iteratorGroupId!,
          // Source group id; caller resolves it to the actual member
          // ids via useAssetStore before calling addToGroup.
          assetIds: [
            // Sentinel: "this is a group id, please expand it before
            // calling addToGroup". We use the prefix "@group:" so the
            // caller can detect + expand. Today's only emitter is
            // here, so the contract is local.
            `@group:${sourceGroupId}`,
          ],
        },
      ];
    }

    // Drop on canvas / non-iterator node → spawn an iterator linked
    // to this group. Iterators are SHARED views on the group; if
    // there's already an iterator pointing at this group elsewhere
    // on the canvas, the user gets two synced views. That's the
    // intended model.
    return [
      {
        type: "spawn-node",
        kind: "image-iterator",
        initialConfig: {
          groupId: sourceGroupId,
          cursor: 0,
          selectionMode: "all",
        },
      },
    ];
  }

  if (payload.kind !== "image") {
    return [
      {
        type: "noop",
        reason: `unsupported-asset-kind:${payload.kind}`,
      },
    ];
  }

  // ── Image payload ─────────────────────────────────────────────────────

  if (droppedOnIterator) {
    return [
      {
        type: "append-to-group",
        groupId: target.iteratorGroupId!,
        assetIds: payload.assetIds,
      },
    ];
  }

  // 1 image OR N images on empty canvas → spawn one Image node per id
  // (Slice 5.6.1). Multi-drag is "put each one on the canvas",
  // matching Finder semantics. Iterator only spawns from a deliberate
  // group-card drag (the asset-group branch above).
  return payload.assetIds.map((id) => ({
    type: "spawn-node" as const,
    kind: "image",
    initialConfig: { assetId: id },
  }));
}
