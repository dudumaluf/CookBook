import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  deleteAssetObject,
  uploadImageAsset,
} from "@/lib/library/upload-asset";
import type {
  Asset,
  AssetGroupAsset,
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
    /**
     * Optional pixel dimensions (Slice 5.6.2). The Export node now
     * passes these through after `uploadImageFromUrl` measures the
     * downloaded image; node previews use them directly for
     * `aspect-ratio` styling without a re-measure.
     */
    width?: number;
    height?: number;
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
   * Batch counterpart of `removeAsset` (Slice 5.6f). Deletes every id in
   * parallel — individual failures are swallowed via `Promise.allSettled`
   * so a single bad id doesn't strand the rest. Useful for multi-select
   * Backspace and the right-click context menu's "Delete N items" item.
   *
   * Group ids land on `removeGroup` (their members survive). Image / Soul
   * ID kinds delegate to `removeAsset`.
   */
  removeAssets: (ids: readonly string[]) => Promise<void>;
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

  /* ─────────────────────────── Groups (Slice 5.6) ─────────────────────── */

  /**
   * Create an `AssetGroup` from a list of `image` asset ids. Order is
   * preserved (the iterator's cursor walks the same order); duplicate
   * ids in the input are silently de-duped (groups are sets visually,
   * even if represented as arrays for ordering).
   *
   * `isUntitled` defaults to `false` — call sites for "auto-group from
   * multi-drag" must set it to `true` so the cleanup rule applies.
   * The default name is `"Untitled <N>"` where N is one more than the
   * count of existing Untitled groups (so they render as a sequence
   * even after deletes); pass `name` to override.
   *
   * Returns the new group id. The underlying `image` assets are NOT
   * checked for existence — defensive consumers (the iterator's
   * execute()) drop unresolvable ids at runtime.
   */
  createGroup: (params: {
    name?: string;
    assetIds: string[];
    isUntitled?: boolean;
    scope?: AssetScope;
  }) => string;

  /** Append asset ids to a group. De-duped against the existing array. */
  addToGroup: (groupId: string, assetIds: string[]) => void;

  /** Remove asset ids from a group. No-op for ids that aren't present. */
  removeFromGroup: (groupId: string, assetIds: string[]) => void;

  /**
   * Rename a group. **Flips `isUntitled` to `false` on first rename**
   * — the user just told us "this is a real group worth keeping", so
   * the cleanup rule no longer applies.
   */
  renameGroup: (groupId: string, name: string) => void;

  /**
   * Drop a group from the library. Does NOT delete the underlying
   * `image` assets — they outlive the group and may live in other
   * groups or be referenced by free-floating Image nodes on the
   * canvas. Drops the group's id from `selectedAssetIds` defensively.
   */
  removeGroup: (groupId: string) => void;

  /**
   * Cleanup rule (Slice 5.6e): if `groupId` resolves to an `Untitled`
   * group AND no node in the workflow currently links to it, drop the
   * group. Called by `canvas-flow.tsx` after deleting an iterator that
   * was linked to it. The walk-the-workflow check is done by the
   * caller and passed in via `linkedNodeIds` so this store stays
   * decoupled from the workflow store.
   *
   * No-op for `false` `isUntitled`, missing groups, or non-empty
   * `linkedNodeIds`. Idempotent.
   */
  cleanupUntitledGroupIfOrphan: (
    groupId: string,
    linkedNodeIds: readonly string[],
  ) => void;

  /* ─────────────────────────── Selection (Slice 5.5c) ─────────────────── */

  /**
   * Library multi-select state. Transient (not persisted via `partialize`)
   * — selection is a session-level UI thing, not part of the durable
   * library. Drives the highlighted ring on AssetCard + the multi-payload
   * the drag handler writes to `dataTransfer`.
   */
  selectedAssetIds: string[];
  /**
   * Anchor for shift-click range selection. Internal — set on every
   * `selectAsset` / `toggleAssetSelection` so the next shift-click knows
   * where to start the range from.
   */
  selectionAnchorId: string | null;
  /** Replace the selection with just this id (plain click). */
  selectAsset: (id: string) => void;
  /** Toggle this id's membership in the selection (cmd / ctrl-click). */
  toggleAssetSelection: (id: string) => void;
  /**
   * Range-select from the current anchor to this id (shift-click).
   * If there's no anchor yet, behaves like `selectAsset`.
   * Range walks `state.assets` insertion order — matches the visual
   * layout the user sees.
   */
  selectAssetRange: (id: string) => void;
  /** Clear the selection (e.g. on click outside the library). */
  clearAssetSelection: () => void;

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
        // The uploader also captures pixel dimensions before the upload
        // (Slice 5.6.2) so the asset ships with width/height when present.
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
          ...(uploaded.width !== undefined ? { width: uploaded.width } : {}),
          ...(uploaded.height !== undefined ? { height: uploaded.height } : {}),
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
          ...(params.width !== undefined ? { width: params.width } : {}),
          ...(params.height !== undefined ? { height: params.height } : {}),
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

      removeAssets: async (ids) => {
        // Snapshot the per-kind buckets BEFORE the optimistic drop so
        // group ids route to `removeGroup` (which only drops the group
        // record) and image/soul-id ids route to `removeAsset` (which
        // also fires the remote bucket cleanup). Using the synchronous
        // store methods so each id keeps its existing semantics
        // (group cleanup vs remote object delete) without us having to
        // reimplement them here.
        const targets = get().assets.filter((a) => ids.includes(a.id));
        const groupIds = targets
          .filter((a) => a.kind === "asset-group")
          .map((a) => a.id);
        const otherIds = targets
          .filter((a) => a.kind !== "asset-group")
          .map((a) => a.id);
        for (const groupId of groupIds) {
          get().removeGroup(groupId);
        }
        // Run remote deletes in parallel; swallow individual failures
        // (Supabase 404 / transient blip) so the rest of the batch
        // still drops locally.
        await Promise.allSettled(
          otherIds.map((id) => get().removeAsset(id)),
        );
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

      /* ──────────────────────── Groups (Slice 5.6) ───────────────────── */

      createGroup: (params) => {
        const id = makeAssetId();
        const now = Date.now();
        // De-dupe assetIds while preserving first-seen order.
        const seen = new Set<string>();
        const orderedIds: string[] = [];
        for (const aid of params.assetIds) {
          if (typeof aid !== "string" || aid.length === 0) continue;
          if (seen.has(aid)) continue;
          seen.add(aid);
          orderedIds.push(aid);
        }
        const isUntitled = params.isUntitled ?? false;
        // Default name: Untitled N (N counts existing Untitled groups so
        // the sequence keeps growing even when middle entries get
        // cleaned up — feels like Finder's "untitled folder 3").
        let name = params.name?.trim();
        if (!name) {
          const untitledCount = get().assets.filter(
            (a): a is AssetGroupAsset =>
              a.kind === "asset-group" && a.isUntitled,
          ).length;
          name = `Untitled ${untitledCount + 1}`;
        }
        const asset: AssetGroupAsset = {
          id,
          kind: "asset-group",
          name,
          tags: [],
          scope: params.scope ?? "project",
          createdAt: now,
          updatedAt: now,
          assetIds: orderedIds,
          isUntitled,
        };
        set((state) => ({ assets: [...state.assets, asset] }));
        return id;
      },

      addToGroup: (groupId, assetIds) => {
        if (assetIds.length === 0) return;
        set((state) => ({
          assets: state.assets.map((a) => {
            if (a.id !== groupId || a.kind !== "asset-group") return a;
            const existing = new Set(a.assetIds);
            const merged = [...a.assetIds];
            for (const id of assetIds) {
              if (typeof id !== "string" || id.length === 0) continue;
              if (existing.has(id)) continue;
              existing.add(id);
              merged.push(id);
            }
            // Skip the write if nothing changed (avoid render churn).
            if (merged.length === a.assetIds.length) return a;
            return { ...a, assetIds: merged, updatedAt: Date.now() };
          }),
        }));
      },

      removeFromGroup: (groupId, assetIds) => {
        if (assetIds.length === 0) return;
        const drop = new Set(assetIds);
        set((state) => ({
          assets: state.assets.map((a) => {
            if (a.id !== groupId || a.kind !== "asset-group") return a;
            const next = a.assetIds.filter((id) => !drop.has(id));
            if (next.length === a.assetIds.length) return a;
            return { ...a, assetIds: next, updatedAt: Date.now() };
          }),
        }));
      },

      renameGroup: (groupId, name) => {
        const trimmed = name.trim();
        if (trimmed.length === 0) return; // ignore empty rename
        set((state) => ({
          assets: state.assets.map((a) => {
            if (a.id !== groupId || a.kind !== "asset-group") return a;
            // Flip isUntitled the first time the user renames — the
            // cleanup rule will leave this group alone from now on.
            return {
              ...a,
              name: trimmed,
              isUntitled: false,
              updatedAt: Date.now(),
            };
          }),
        }));
      },

      removeGroup: (groupId) => {
        set((state) => ({
          assets: state.assets.filter(
            (a) => !(a.id === groupId && a.kind === "asset-group"),
          ),
          // Defensively scrub the id from the selection in case a group
          // card was selected when deletion happened.
          selectedAssetIds: state.selectedAssetIds.filter(
            (id) => id !== groupId,
          ),
        }));
      },

      cleanupUntitledGroupIfOrphan: (groupId, linkedNodeIds) => {
        if (linkedNodeIds.length > 0) return;
        const group = get().assets.find(
          (a): a is AssetGroupAsset =>
            a.id === groupId && a.kind === "asset-group",
        );
        if (!group || !group.isUntitled) return;
        set((state) => ({
          assets: state.assets.filter((a) => a.id !== groupId),
        }));
      },

      /* ────────────────────── Selection (Slice 5.5c) ─────────────────── */

      selectedAssetIds: [],
      selectionAnchorId: null,
      selectAsset: (id) => {
        set({ selectedAssetIds: [id], selectionAnchorId: id });
      },
      toggleAssetSelection: (id) => {
        const current = get().selectedAssetIds;
        const isAlreadyIn = current.includes(id);
        set({
          selectedAssetIds: isAlreadyIn
            ? current.filter((x) => x !== id)
            : [...current, id],
          // Even when toggling-OFF, remember the id as the next anchor
          // so shift-click after a cmd-click feels right.
          selectionAnchorId: id,
        });
      },
      selectAssetRange: (id) => {
        const anchor = get().selectionAnchorId;
        if (!anchor) {
          // No anchor → behave like a plain click.
          set({ selectedAssetIds: [id], selectionAnchorId: id });
          return;
        }
        // Walk insertion order and pick everything between anchor and id
        // (inclusive). Order is whatever index they sit at in `assets`.
        const ids = get().assets.map((a) => a.id);
        const a = ids.indexOf(anchor);
        const b = ids.indexOf(id);
        if (a < 0 || b < 0) {
          // Edge case: the anchor or target was removed since last click.
          set({ selectedAssetIds: [id], selectionAnchorId: id });
          return;
        }
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        set({
          selectedAssetIds: ids.slice(start, end + 1),
          // Anchor stays where it is — the user can shift-click again to
          // grow / shrink the range from the same starting point. (Matches
          // Finder + Photoshop layer-list behaviour.)
        });
      },
      clearAssetSelection: () =>
        set({ selectedAssetIds: [], selectionAnchorId: null }),

      clear: () =>
        set({
          assets: [],
          selectedAssetIds: [],
          selectionAnchorId: null,
        }),
    }),
    {
      name: "cookbook.assets",
      storage: createJSONStorage(() => localStorage),
      version: 5,
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
       * v4 → v5: additive — adds the `asset-group` kind (Slice 5.6 /
       *   ADR-0032). No existing asset payload changes shape; the new
       *   kind only appears once a user creates a group post-v5. The
       *   migration still runs a defensive sanity sweep that drops any
       *   `asset-group` row whose required fields (`assetIds: string[]`,
       *   `isUntitled: boolean`) are missing — protects against hand-
       *   edited localStorage.
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
          if (version < 5) {
            // Defensive sweep on the new asset-group kind. Hand-edited
            // payloads might be missing assetIds / isUntitled; we drop
            // those rows so the iterator's resolver doesn't crash on
            // `group.assetIds.map`. Clean v4 payloads (image + soul-id
            // only) pass through untouched — asset-group didn't exist.
            state.assets = state.assets.filter((raw) => {
              const a = raw as Asset;
              if (a.kind !== "asset-group") return true;
              const candidate = a as Partial<AssetGroupAsset>;
              return (
                Array.isArray(candidate.assetIds) &&
                typeof candidate.isUntitled === "boolean"
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
