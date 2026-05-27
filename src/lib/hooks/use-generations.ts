"use client";

import { useCallback, useEffect, useState } from "react";

import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";
import {
  type GenerationFilter,
  type GenerationRecord,
} from "@/lib/repositories/generation-repository";

/**
 * useGenerations — Slice 6.2.
 *
 * React hook over the `cookbook_generations` table. Returns the most
 * recent rows that match the filter, plus loading + error state and a
 * `refresh()` function that bypasses any internal cache.
 *
 * No external state-management lib (no React Query / SWR yet) — keep
 * the surface tiny + dependency-light. Re-fetches on filter change and
 * on explicit `refresh()` call. Background updates from
 * `generation-sync.startAutoPersistGenerations` aren't pushed via
 * subscription yet — Slice 6.4 / M0c will move to realtime; for now,
 * Gallery refetches when re-opened or via the "Refresh" affordance.
 */

export interface UseGenerationsResult {
  data: GenerationRecord[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const DEFAULT_LIMIT = 100;

export function useGenerations(
  filter: GenerationFilter | null,
): UseGenerationsResult {
  const [data, setData] = useState<GenerationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Stable string key over the filter — feeds useEffect deps cleanly so
  // `refresh` re-runs on any field change. Using an object dep would
  // re-fire on every render because the parent re-creates the object.
  const filterKey = filter
    ? JSON.stringify({
        p: filter.projectId,
        n: filter.nodeId,
        k: filter.nodeKind,
        pin: filter.pinnedOnly,
        s: filter.promptContains,
        l: filter.limit,
        o: filter.offset,
      })
    : null;

  // Bumping this counter on `refresh()` triggers the effect below,
  // sidestepping the react-hooks/set-state-in-effect lint rule about
  // calling setState directly inside an effect from a callback.
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(async () => {
    setRefreshTick((n) => n + 1);
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  // The whole point of this effect is to mirror filter -> server data, which
  // requires setState. The lint rule is over-broad here.
  useEffect(() => {
    if (!filter) {
      setData([]);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const rows = await getGenerationRepository().list({
          ...filter,
          limit: filter.limit ?? DEFAULT_LIMIT,
        });
        if (cancelled) return;
        setData(rows);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filterKey, refreshTick]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  return { data, isLoading, error, refresh };
}
