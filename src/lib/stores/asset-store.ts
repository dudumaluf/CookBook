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
      version: 3,
      /**
       * Migration ladder.
       *
       * v1 → v2: flatten legacy `{ url }` into `source: { type: "url" }`.
       * v2 → v3: drop the abandoned `{ type: "blob" }` shape — the bytes
       *   lived in IndexedDB which we no longer write to, so a v2 blob
       *   asset would render as a broken placeholder forever. Cleaner to
       *   drop the metadata record entirely and let the user re-upload.
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
              // Drop the v2 `blob` shape (bytes are gone — they lived only
              // in IndexedDB which we no longer maintain).
              return !(
                a.kind === "image" &&
                (a.source as { type: string }).type === "blob"
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
