/**
 * Drop dispatcher (Slice 5.5c, ADR-0031).
 *
 * Decides what happens when an asset payload from the library lands on
 * the canvas. Pure / framework-agnostic — takes the dispatched payload
 * + the resolved drop context and returns a description of the action;
 * the caller (`canvas-flow.tsx`'s `onDrop`) is responsible for wiring
 * the result into store mutations.
 *
 * The decision tree:
 *
 *   1 image asset, dropped on empty canvas
 *      → spawn 1 Image node (legacy behaviour preserved)
 *   1 image asset, dropped on an existing Image Iterator
 *      → append assetId to the iterator's `assetIds`
 *   N (≥ 2) image assets, dropped on empty canvas
 *      → spawn 1 new Image Iterator pre-populated with all N assetIds
 *   N (≥ 2) image assets, dropped on an existing Image Iterator
 *      → append all N assetIds to the iterator's `assetIds`
 *
 *   Any number of soul-id assets, dropped on empty canvas
 *      → spawn 1 SoulID node per asset (legacy single-spawn loops)
 *      (Iterator semantics don't apply — Soul ID nodes aren't
 *      iterator-flagged in the engine.)
 *
 *   Drop target is some other existing node (Higgsfield, LLM, …)
 *      → fall through to "spawn new Image / SoulID node next to it"
 *      (we don't auto-wire — too magical, and the user might not want
 *      that asset on that node's input handle).
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
}

/**
 * Action descriptor returned to the caller. The caller maps each variant
 * to the appropriate workflow-store mutation.
 */
export type AssetDropAction =
  | {
      type: "spawn-node";
      kind: string;
      initialConfig: Record<string, unknown>;
    }
  | {
      type: "append-to-iterator";
      iteratorId: string;
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
      // We pass only `assetId` here; canvas-flow will resolve the rest
      // through `assetToNode` after looking up the asset in the store.
      // Keeping this dispatcher store-agnostic.
      initialConfig: { assetId: id },
    }));
  }

  if (payload.kind !== "image") {
    return [
      {
        type: "noop",
        reason: `unsupported-asset-kind:${payload.kind}`,
      },
    ];
  }

  // Image. Branch on drop target + asset count.
  const droppedOnIterator =
    target?.nodeKind === "image-iterator" && target.nodeId !== undefined;

  if (droppedOnIterator) {
    return [
      {
        type: "append-to-iterator",
        iteratorId: target.nodeId!,
        assetIds: payload.assetIds,
      },
    ];
  }

  if (payload.assetIds.length === 1) {
    // 1 image, empty canvas (or non-iterator node) → spawn 1 Image node.
    // The caller fills in `url` from the asset store before passing
    // `initialConfig` to `addNode`.
    return [
      {
        type: "spawn-node",
        kind: "image",
        initialConfig: { assetId: payload.assetIds[0]! },
      },
    ];
  }

  // N images, empty canvas → spawn an Image Iterator pre-populated.
  return [
    {
      type: "spawn-node",
      kind: "image-iterator",
      initialConfig: {
        assetIds: payload.assetIds,
        cursor: 0,
        selectionMode: "all",
      },
    },
  ];
}
