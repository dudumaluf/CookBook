/**
 * Translates a dropped Asset into the node kind + initial config that should
 * be spawned on the canvas.
 *
 * Add a new entry here when introducing a new AssetKind. The map is the
 * single source of truth for asset → node coupling so the drag handler in
 * `canvas-flow.tsx` stays kind-agnostic.
 */

import type { Asset, AssetKind } from "@/types/asset";

export interface AssetToNodeResult {
  kind: string;
  initialConfig: Record<string, unknown>;
}

type SpawnFn<TAsset extends Asset> = (asset: TAsset) => AssetToNodeResult;

// Per-kind spawn rules. New asset kinds register here; nothing else changes.
const SPAWN: { [K in AssetKind]: SpawnFn<Extract<Asset, { kind: K }>> } = {
  image: (asset) => ({
    kind: "image",
    initialConfig: {
      assetId: asset.id,
      // Denormalize the url so the node keeps working as a standalone if
      // the asset is later deleted. `source.url` is always a real fetchable
      // URL (cloud upload or paste-a-URL) since we ditched the local-blob
      // detour — see ADR-0018b.
      url: asset.source.url,
    },
  }),
  "soul-id": (asset) => ({
    kind: "soul-id",
    initialConfig: {
      assetId: asset.id,
      // Denormalize the character reference so the node keeps working as
      // a standalone if the asset is later removed from the library — same
      // pattern as the image node carries `url` alongside `assetId`.
      customReferenceId: asset.customReferenceId,
      variant: asset.variant,
      name: asset.name,
      thumbnailUrl: asset.thumbnailUrl,
    },
  }),
  // Asset group (Slice 5.6, ADR-0032). Drag of a group spawns an
  // `image-iterator` linked to it via `groupId`. The iterator becomes a
  // *view* of the group; library edits propagate naturally.
  //
  // M0b: a group trained as a Soul ID (soulTraining.status === "ready")
  // spawns a `soul-id` node instead — the group "is" a Soul ID now, so
  // dropping it gives you the character reference, not an image set.
  "asset-group": (asset) => {
    const st = asset.soulTraining;
    if (st && st.status === "ready" && st.customReferenceId) {
      return {
        kind: "soul-id",
        initialConfig: {
          assetId: asset.id,
          customReferenceId: st.customReferenceId,
          variant: st.variant,
          name: asset.name,
          thumbnailUrl: st.thumbnailUrl,
        },
      };
    }
    return {
      kind: "image-iterator",
      initialConfig: {
        groupId: asset.id,
        cursor: 0,
        selectionMode: "all",
      },
    };
  },
  // Video / audio assets (Slice A — multimodal media arc). The `video` and
  // `audio` input nodes land in Slices B/C; the spawn mapping is registered
  // now so the AssetKind union stays exhaustive. No video/audio assets can
  // exist yet (no creation path until those slices), so dropping one before
  // the node exists is not reachable today.
  video: (asset) => ({
    kind: "video",
    initialConfig: {
      assetId: asset.id,
      url: asset.source.url,
    },
  }),
  audio: (asset) => ({
    kind: "audio",
    initialConfig: {
      assetId: asset.id,
      url: asset.source.url,
    },
  }),
};

export function assetToNode(asset: Asset): AssetToNodeResult {
  // The type system already enforces every AssetKind has a SPAWN entry; the
  // runtime cast just satisfies the per-key narrowing TS can't infer.
  const fn = SPAWN[asset.kind] as SpawnFn<Asset>;
  return fn(asset);
}
