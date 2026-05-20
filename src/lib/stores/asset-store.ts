import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  deleteAssetObject,
  uploadImageAsset,
} from "@/lib/library/upload-asset";
import type {
  Asset,
  AssetKind,
  AssetScope,
  ImageAsset,
  SoulIdAsset,
} from "@/types/asset";

/**
 * Asset store: the Library's source of truth.
 *
 * Strict separation from the workflow store: assets are *reusable* and may
 * outlive any individual node on the canvas. A node referencing an asset by
 * `assetId` is just holding a foreign key — deleting the asset doesn't delete
 * the node, but the node's preview will degrade gracefully.
 *
 * Persistence + bytes:
 *  - Image bytes live in **Supabase Storage** (`cookbook-assets` bucket).
 *    Upload happens directly from the browser using the publishable key;
 *    a bucket-scoped INSERT policy authorizes it. The returned public URL
 *    is the canonical source of truth for downstream consumers (UI + every
 *    remote inference API can fetch it).
 *  - Metadata (name, tags, scope, source descriptor incl. that URL) →
 *    `localStorage` via Zustand `persist` with `skipHydration` so SSR stays
 *    happy. SQLite (Drizzle) replaces localStorage in Slice 5 via a
 *    Repository abstraction — the public API here stays stable.
 *
 * The earlier IndexedDB-local-blob detour from Slice 2.1 is gone (see
 * ADR-0018b for the post-mortem). Going cloud-canonical unblocks Slice 4's
 * image generation nodes immediately and removes a whole class of "the URL
 * the API saw is a dead `blob:` from your browser" footguns.
 */
export interface AssetState {
  assets: Asset[];

  /**
   * Upload a File from disk → Supabase Storage → create a metadata record
   * pointing at the resulting public URL. Returns the new asset id.
   *
   * Throws if the upload fails (the caller — usually the import pipeline —
   * is responsible for surfacing the error to the user via a toast).
   */
  createImageAssetFromFile: (
    file: File,
    params?: {
      name?: string;
      tags?: string[];
      scope?: AssetScope;
    },
  ) => Promise<string>;

  /** Create an Image asset from a remote URL (the "Paste URL" escape hatch). */
  createImageAssetFromUrl: (params: {
    url: string;
    name?: string;
    tags?: string[];
    scope?: AssetScope;
  }) => string;

  /**
   * Commit an already-uploaded image (e.g. from the Export node, which has
   * just downloaded a Higgsfield result and re-uploaded the bytes to our
   * own bucket) as a `remote`-source asset. Skips the File → upload step
   * entirely — the caller already has the descriptor.
   */
  createImageAssetFromUploaded: (params: {
    bucket: string;
    key: string;
    url: string;
    mime: string;
    sizeBytes: number;
    name: string;
    tags?: string[];
    scope?: AssetScope;
  }) => string;

  /**
   * Import a Higgsfield Soul ID character into the library. Stores only the
   * character reference (UUID + variant + cover thumbnail); the bytes never
   * touch our storage — Higgsfield owns the trained model. ADR-0029.
   *
   * Returns the new asset id. Idempotent on `customReferenceId`: if the
   * character is already in the library, returns the existing id without
   * creating a duplicate (so re-clicking "Import" in the popover is safe).
   */
  importSoulIdAsset: (params: {
    customReferenceId: string;
    variant: "v1" | "v2" | "cinema";
    name: string;
    thumbnailUrl?: string | null;
    tags?: string[];
    scope?: AssetScope;
  }) => string;

  /**
   * Delete an asset. For `remote`-source assets, also deletes the Supabase
   * Storage object (best-effort — a failed cleanup is logged, not thrown,
   * so a transient network blip doesn't strand the UI).
   */
  removeAsset: (id: string) => Promise<void>;
  /**
   * Patch fields on an existing asset. `kind` and `source` are immutable
   * via this API (replace the asset if you need to swap source); `updatedAt`
   * is bumped automatically.
   */
  updateAsset: (
    id: string,
    patch: Partial<
      Omit<Asset, "id" | "kind" | "source" | "createdAt" | "updatedAt">
    >,
  ) => void;
  getAsset: (id: string) => Asset | undefined;
  listByScope: (scope: AssetScope) => Asset[];
  /** Type-safe filter by kind discriminator. */
  listByKind: <K extends AssetKind>(
    kind: K,
  ) => Extract<Asset, { kind: K }>[];
  clear: () => void;
}

function makeAssetId(): string {
  return `asset_${Math.random().toString(36).slice(2, 10)}`;
}

/** Strip an image's filename extension for a sane default `name`. */
function deriveNameFromFile(file: File): string {
  const dot = file.name.lastIndexOf(".");
  return dot > 0 ? file.name.slice(0, dot) : file.name;
}

export const useAssetStore = create<AssetState>()(
  persist(
    (set, get) => ({
      assets: [],

      createImageAssetFromFile: async (file, params) => {
        // Upload first; if Supabase fails we never commit a half-built record.
        const uploaded = await uploadImageAsset(file);
        const id = makeAssetId();
        const now = Date.now();
        const asset: ImageAsset = {
          id,
          kind: "image",
          name: params?.name?.trim() || deriveNameFromFile(file),
          tags: params?.tags ?? [],
          scope: params?.scope ?? "project",
          source: {
            type: "remote",
            bucket: uploaded.bucket,
            key: uploaded.key,
            url: uploaded.url,
            mime: uploaded.mime,
            sizeBytes: uploaded.sizeBytes,
          },
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ assets: [...state.assets, asset] }));
        return id;
      },

      createImageAssetFromUrl: (params) => {
        const id = makeAssetId();
        const now = Date.now();
        const url = params.url.trim();
        const fallbackName =
          url.split("/").filter(Boolean).pop() ?? "Untitled";
        const asset: ImageAsset = {
          id,
          kind: "image",
          name: params.name?.trim() || fallbackName,
          tags: params.tags ?? [],
          scope: params.scope ?? "project",
          source: { type: "url", url },
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ assets: [...state.assets, asset] }));
        return id;
      },

      createImageAssetFromUploaded: (params) => {
        const id = makeAssetId();
        const now = Date.now();
        const asset: ImageAsset = {
          id,
          kind: "image",
          name: params.name.trim() || "Untitled",
          tags: params.tags ?? [],
          scope: params.scope ?? "project",
          source: {
            type: "remote",
            bucket: params.bucket,
            key: params.key,
            url: params.url,
            mime: params.mime,
            sizeBytes: params.sizeBytes,
          },
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ assets: [...state.assets, asset] }));
        return id;
      },

      importSoulIdAsset: (params) => {
        const ref = params.customReferenceId.trim();
        // De-dupe: if a Soul ID asset with this customReferenceId already
        // exists, return its id — re-importing is a no-op so the popover's
        // "Import" button is idempotent.
        const existing = get().assets.find(
          (a): a is SoulIdAsset =>
            a.kind === "soul-id" && a.customReferenceId === ref,
        );
        if (existing) return existing.id;

        const id = makeAssetId();
        const now = Date.now();
        const asset: SoulIdAsset = {
          id,
          kind: "soul-id",
          name: params.name.trim() || ref,
          tags: params.tags ?? [],
          scope: params.scope ?? "global",
          customReferenceId: ref,
          variant: params.variant,
          thumbnailUrl: params.thumbnailUrl ?? null,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ assets: [...state.assets, asset] }));
        return id;
      },

      removeAsset: async (id) => {
        const asset = get().assets.find((a) => a.id === id);
        // Optimistic local drop — the UI updates immediately; if the
        // remote delete fails the orphaned object is harmless.
        set((state) => ({ assets: state.assets.filter((a) => a.id !== id) }));
        if (asset?.kind === "image" && asset.source.type === "remote") {
          await deleteAssetObject(asset.source.bucket, asset.source.key);
        }
      },

      updateAsset: (id, patch) => {
        set((state) => ({
          assets: state.assets.map((a) =>
            a.id === id
              ? // Cast: TS can't see that spreading a Partial<Omit<…>> onto an
                // Asset preserves the discriminator. We never patch `kind`
                // or `source` through this path.
                ({ ...a, ...patch, updatedAt: Date.now() } as Asset)
              : a,
          ),
        }));
      },

      getAsset: (id) => get().assets.find((a) => a.id === id),

      listByScope: (scope) => get().assets.filter((a) => a.scope === scope),

      listByKind: <K extends AssetKind>(kind: K) =>
        get().assets.filter((a) => a.kind === kind) as Extract<
          Asset,
          { kind: K }
        >[],

      clear: () => set({ assets: [] }),
    }),
    {
      name: "cookbook.assets",
      storage: createJSONStorage(() => localStorage),
      version: 4,
      /**
       * Migration ladder.
       *
       * v1 → v2: flatten legacy `{ url }` into `source: { type: "url" }`.
       * v2 → v3: drop the abandoned `{ type: "blob" }` shape — the bytes
       *   lived in IndexedDB which we no longer write to, so a v2 blob
       *   asset would render as a broken placeholder forever. Cleaner to
       *   drop the metadata record entirely and let the user re-upload.
       * v3 → v4: forward-portable sanity sweep that drops any soul-id
       *   asset whose required fields are malformed (missing
       *   customReferenceId or unknown variant). A clean v3 payload —
       *   which only contained image kinds — survives unchanged.
       *
       * Future versions fall through unchanged.
       */
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<AssetState>;
        if (Array.isArray(state.assets)) {
          if (version < 2) {
            state.assets = state.assets.map((raw) => {
              const a = raw as ImageAsset & { url?: string };
              if (a.kind !== "image" || a.source) return a;
              const url = typeof a.url === "string" ? a.url : "";
              const migrated: ImageAsset = {
                id: a.id,
                kind: "image",
                name: a.name,
                tags: a.tags ?? [],
                scope: a.scope,
                createdAt: a.createdAt,
                updatedAt: a.updatedAt,
                source: { type: "url", url },
                width: a.width,
                height: a.height,
              };
              return migrated;
            });
          }
          if (version < 3) {
            state.assets = state.assets.filter((raw) => {
              const a = raw as ImageAsset;
              return !(
                a.kind === "image" &&
                (a.source as { type: string }).type === "blob"
              );
            });
          }
          if (version < 4) {
            const validVariants = new Set(["v1", "v2", "cinema"]);
            state.assets = state.assets.filter((raw) => {
              const a = raw as Asset;
              if (a.kind !== "soul-id") return true;
              const candidate = a as Partial<SoulIdAsset>;
              return (
                typeof candidate.customReferenceId === "string" &&
                candidate.customReferenceId.length > 0 &&
                typeof candidate.variant === "string" &&
                validVariants.has(candidate.variant)
              );
            });
          }
        }
        return state as AssetState;
      },
      skipHydration: true,
      partialize: (state) => ({ assets: state.assets }),
    },
  ),
);
