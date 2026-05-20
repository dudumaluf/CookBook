/**
 * Asset types.
 *
 * An Asset is a reusable piece of content that lives in the Library and can
 * be dragged onto the canvas. The same data model backs both global assets
 * (visible across all projects — Soul ID models, recurring moodboards) and
 * project-scoped assets (single project's photoshoot, references).
 *
 * Slice 2 ships only `image`. Future kinds (`imageGroup`, `soulId`,
 * `moodboard`, `product`, `video`, …) extend the `Asset` union — each gets
 * its own discriminator + payload, plus a node kind to spawn on canvas drop
 * (registered in `lib/library/asset-to-node.ts`).
 *
 * Decisions live in ADR-0018 (DECISIONS.md).
 */

/* ────────────────────────────────────────────────────────────────────────── */
/* Scope                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * `global` assets are visible across all projects (Soul ID models you reuse,
 * a moodboard you like for every commercial). `project` assets live with the
 * current project only.
 *
 * Duplicating a project must NOT duplicate the asset blobs — both project
 * copies reference the same asset ids. That's why this scope flag exists at
 * the asset level instead of being implied by storage location.
 */
export type AssetScope = "global" | "project";

/* ────────────────────────────────────────────────────────────────────────── */
/* Asset union                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

interface AssetCommon {
  id: string;
  name: string;
  tags: string[];
  scope: AssetScope;
  createdAt: number;
  updatedAt: number;
}

/**
 * Where an image's bytes actually live.
 *
 * - `remote` — the bytes were uploaded by us to Supabase Storage (the
 *   `cookbook-assets` bucket). `url` is the cached CDN-cacheable public
 *   URL; `bucket` + `key` are kept so `removeAsset` can delete the object
 *   and a future "re-issue signed URL" path has what it needs. **Primary
 *   path** — every file-pick / drop / paste from the user lands here.
 *
 * - `url` — an externally hosted image we don't own (paste-a-URL escape
 *   hatch, generation result whose host URL we trust). No bytes uploaded.
 *
 * Every consumer reads `source.url` directly — synchronous, no hook
 * juggling, because the URL is the URL in both cases.
 *
 * A future `{ type: "signed" }` variant for private buckets slots in
 * alongside these without breaking existing assets. See ADR-0018b.
 */
export type ImageAssetSource =
  | {
      type: "remote";
      bucket: string;
      key: string;
      url: string;
      mime: string;
      sizeBytes: number;
    }
  | { type: "url"; url: string };

export interface ImageAsset extends AssetCommon {
  kind: "image";
  source: ImageAssetSource;
  width?: number;
  height?: number;
}

/**
 * The full Asset union. New kinds get added here and to
 * `lib/library/asset-to-node.ts`.
 */
export type Asset = ImageAsset;

export type AssetKind = Asset["kind"];

/** Helper: narrow an Asset to a specific kind. */
export function isAssetKind<K extends AssetKind>(
  asset: Asset,
  kind: K,
): asset is Extract<Asset, { kind: K }> {
  return asset.kind === kind;
}
