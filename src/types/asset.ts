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
 * Where a media (video / audio) file's bytes live. Same `remote` vs `url`
 * split as images (ADR-0018b) — `remote` is uploaded to our Supabase bucket
 * and we own the object; `url` is an externally hosted file we trust (a Fal
 * CDN result we haven't rehosted yet, a paste-a-URL escape hatch).
 */
export type MediaAssetSource =
  | {
      type: "remote";
      bucket: string;
      key: string;
      url: string;
      mime: string;
      sizeBytes: number;
    }
  | { type: "url"; url: string };

/**
 * Video asset (Slice A — multimodal media arc). Generated clips (Seedance),
 * uploaded driving videos, or stitched results land here so they survive as
 * durable, user-owned library items (Fal CDN URLs are not user-owned).
 */
export interface VideoAsset extends AssetCommon {
  kind: "video";
  source: MediaAssetSource;
  durationMs?: number;
  width?: number;
  height?: number;
}

/**
 * Audio asset (Slice A — multimodal media arc). Songs the user uploads, TTS
 * narration, or sliced windows. The Continuity Builder feeds these to
 * Seedance for lip-sync.
 */
export interface AudioAsset extends AssetCommon {
  kind: "audio";
  source: MediaAssetSource;
  durationMs?: number;
}

/**
 * Higgsfield Soul ID character reference (Slice 4, ADR-0029).
 *
 * `customReferenceId` is the UUID Higgsfield assigns each trained character
 * (their `custom_reference_id` field). `variant` records which Soul model
 * the character was trained with — generation endpoints accept characters
 * only on the matching variant (v2-trained character → /soul/v2/standard;
 * cinema-trained → /soul/cinema; v1-trained → /soul/{standard|character|
 * reference}). Sent through the graph as `{ type: "soul-id", value: SoulIdRef }`.
 *
 * No bytes — Soul ID assets are pure references to characters that live in
 * the user's Higgsfield account; the thumbnail URL is the cover image
 * Higgsfield exposes from its `reference_media` array.
 *
 * Slice 4 ships this as the `kind` for already-trained characters imported
 * from the user's account via /api/higgsfield/soul-ids. M0b adds the
 * full training flow (uploads → POST /v1/custom-references → poll), at
 * which point we'll add `status: "training" | "ready"` so a draft can sit
 * in the library while training is in flight.
 */
export interface SoulIdAsset extends AssetCommon {
  kind: "soul-id";
  customReferenceId: string;
  variant: "v1" | "v2" | "cinema";
  thumbnailUrl: string | null;
}

/**
 * Asset group (Slice 5.6, ADR-0032).
 *
 * A named, ordered set of `image` asset ids. The library is the single
 * source of truth for "which images are in this set"; the canvas's
 * Image Iterator is just a *view* over that set (linked via
 * `config.groupId`). Adding / removing / renaming happens here, and
 * every iterator pointing at this group reflects the change naturally.
 *
 * `assetIds` only contains `image` ids today (M0a doesn't ship cross-
 * kind groups — soul-id stays a singleton kind). Order matters; it's
 * the order the iterator emits in `selectionMode: "all"` and the order
 * the cursor walks in `increment` / `decrement`. Group nesting is
 * out of scope for M0a (groups are flat).
 *
 * `isUntitled` is the "auto-created on multi-drag, never named" flag.
 * It's the trigger for `cleanupUntitledGroupIfOrphan` — an iterator
 * deletion that orphans an Untitled group also drops the group, so the
 * library doesn't accumulate "Untitled 1" / "Untitled 2" / … the user
 * never asked for. Renaming the group flips this to `false` (the user
 * just told us "this is a real group worth keeping"), and the cleanup
 * leaves it alone.
 *
 * No bytes — groups are pure metadata. The `image` ids inside survive
 * group deletion (they're the durable thing); the group is just one
 * way to organise them.
 */
export interface AssetGroupAsset extends AssetCommon {
  kind: "asset-group";
  /** Ordered `image` asset ids the group references. */
  assetIds: string[];
  /**
   * `true` for groups created automatically (multi-drag from library →
   * canvas, or the per-iterator workflow-store v8→v9 migration). The
   * cleanup rule drops these when their last iterator goes away.
   * Renaming the group flips this to `false` permanently.
   */
  isUntitled: boolean;
}

/**
 * The full Asset union. New kinds get added here and to
 * `lib/library/asset-to-node.ts`.
 */
export type Asset =
  | ImageAsset
  | SoulIdAsset
  | AssetGroupAsset
  | VideoAsset
  | AudioAsset;

export type AssetKind = Asset["kind"];

/** Helper: narrow an Asset to a specific kind. */
export function isAssetKind<K extends AssetKind>(
  asset: Asset,
  kind: K,
): asset is Extract<Asset, { kind: K }> {
  return asset.kind === kind;
}
