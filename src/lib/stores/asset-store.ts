import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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
 * Persistence: localStorage in M0a. SQLite (Drizzle) replaces this in M0a
 * Slice 5 via the Repository abstraction, keeping the store API stable.
 */
export interface AssetState {
  assets: Asset[];

  /** Create an Image asset. Returns the new id. */
  createImageAsset: (
    params: Omit<ImageAsset, "id" | "kind" | "createdAt" | "updatedAt">,
  ) => string;
  removeAsset: (id: string) => void;
  /**
   * Patch fields on an existing asset. `kind` is immutable; pass the rest as
   * a partial. `updatedAt` is bumped automatically.
   */
  updateAsset: (
    id: string,
    patch: Partial<Omit<Asset, "id" | "kind" | "createdAt" | "updatedAt">>,
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

export const useAssetStore = create<AssetState>()(
  persist(
    (set, get) => ({
      assets: [],

      createImageAsset: (params) => {
        const id = makeAssetId();
        const now = Date.now();
        const asset: ImageAsset = {
          id,
          kind: "image",
          createdAt: now,
          updatedAt: now,
          ...params,
        };
        set((state) => ({ assets: [...state.assets, asset] }));
        return id;
      },

      removeAsset: (id) => {
        set((state) => ({ assets: state.assets.filter((a) => a.id !== id) }));
      },

      updateAsset: (id, patch) => {
        set((state) => ({
          assets: state.assets.map((a) =>
            a.id === id
              ? // Cast: TS can't see that spreading a Partial<Omit<…>> onto an
                // Asset preserves the discriminator. We never patch `kind`.
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
      version: 1,
      migrate: (persistedState) => persistedState as Partial<AssetState>,
      skipHydration: true,
      partialize: (state) => ({ assets: state.assets }),
    },
  ),
);
