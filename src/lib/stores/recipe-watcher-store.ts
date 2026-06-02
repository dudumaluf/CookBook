import { create } from "zustand";

import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import { useEffect } from "react";

/**
 * Recipe-watcher store — Cookbook Library Phase B2 (ADR-0060).
 *
 * Tiny pub/sub on `Map<recipeId, currentVersion>` so on-canvas composite
 * nodes can detect "the recipe I was instantiated from has moved on" in
 * < 50ms without each composite querying the cloud independently.
 *
 * Hydration:
 *   - `refresh({ ownerId, includeSystem })` fetches every recipe the
 *     user can see and rebuilds the version map. Called by:
 *       (1) `RecipeEditShell` / `Cookbook overlay` on mount,
 *       (2) `recipe-edit-session.saveRecipeEdit` on success (so a
 *           Save in this tab propagates to badges instantly),
 *       (3) `window.focus` listener registered by the consumer (so
 *           edits in another tab / migrations / other devices land
 *           when the user comes back to the tab).
 *
 * What this store deliberately does NOT do:
 *   - Subscribe to Supabase Realtime — overkill for B2; the local
 *     channel + focus-refresh is enough for single-user-per-recipe.
 *   - Hold the full recipe rows — only `(id, version)` pairs. Saves
 *     memory + invalidation surface; consumers fetch the row when they
 *     actually need the new subgraph (Update click).
 */
export interface RecipeWatcherState {
  /** Current version per recipe id. Missing key = recipe never seen by
   *  this watcher (composite shows no badge — defensive). */
  versions: Map<string, number>;
  /** True between the start of the first refresh and its resolution.
   *  Lets consumers gate "Update available" so we don't flash the badge
   *  on a stale workflow while we're still loading the watcher. */
  hydrated: boolean;
  /** Bumped on every `refresh()` resolve. Test seam — components don't
   *  read it; useful for `await waitFor(() => cycle > 0)`. */
  refreshCycle: number;
  /** Pure helper — returns the version of `recipeId` if known. */
  getVersion: (recipeId: string) => number | null;
  /** Re-fetch from the cloud + replace the map. Idempotent — concurrent
   *  callers wait on a single in-flight promise. */
  refresh: (filter: { ownerId: string | null; includeSystem: boolean }) => Promise<void>;
  /** Test/debug helper — overwrite the map directly without hitting the
   *  cloud. Exit hatch for unit tests. */
  _seed: (versions: Map<string, number>) => void;
}

let inFlight: Promise<void> | null = null;

export const useRecipeWatcherStore = create<RecipeWatcherState>()((set, get) => ({
  versions: new Map(),
  hydrated: false,
  refreshCycle: 0,

  getVersion: (recipeId) => {
    const v = get().versions.get(recipeId);
    return typeof v === "number" ? v : null;
  },

  refresh: async (filter) => {
    // Coalesce concurrent refreshes — multiple composites mounting on
    // the same render shouldn't all kick off independent queries.
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const records = await getRecipeRepository().list({
          ...(filter.ownerId !== undefined ? { ownerId: filter.ownerId } : {}),
          includeSystem: filter.includeSystem,
          limit: 200,
        });
        const next = new Map<string, number>();
        for (const r of records) next.set(r.id, r.version);
        set((s) => ({
          versions: next,
          hydrated: true,
          refreshCycle: s.refreshCycle + 1,
        }));
      } catch (err) {
        // Refresh failure isn't fatal — bademges just won't appear.
        // Log so production telemetry can spot persistent failures.
        console.warn("[recipe-watcher] refresh failed:", err);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  _seed: (versions) =>
    set((s) => ({
      versions: new Map(versions),
      hydrated: true,
      refreshCycle: s.refreshCycle + 1,
    })),
}));

/**
 * Sugar selector for components rendering one composite — bit cheaper
 * than reading the whole map. Returns `null` until the store hydrates
 * OR the recipe id isn't tracked.
 */
export function useRecipeCurrentVersion(
  recipeId: string | null,
): number | null {
  return useRecipeWatcherStore((s) =>
    !recipeId || !s.hydrated ? null : s.versions.get(recipeId) ?? null,
  );
}

/**
 * Mount-time hydration hook — registers a `window.focus` listener so a
 * tab regaining focus refreshes the version map (catches edits from
 * other tabs / migrations / other devices). Call this in shells that
 * render composites: `AppShell`, `RecipeEditShell`. No-op when
 * `userId` is null (auth not yet ready).
 */
export function useRecipeWatcherHydration(args: {
  userId: string | null | undefined;
}): void {
  const { userId } = args;
  const refresh = useRecipeWatcherStore((s) => s.refresh);
  useEffect(() => {
    if (!userId) return;
    void refresh({ ownerId: userId, includeSystem: true });
    function onFocus() {
      void refresh({ ownerId: userId!, includeSystem: true });
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [userId, refresh]);
}
