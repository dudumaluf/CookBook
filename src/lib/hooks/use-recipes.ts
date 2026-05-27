"use client";

import { useCallback, useEffect, useState } from "react";

import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import {
  type RecipeFilter,
  type RecipeRecord,
} from "@/lib/repositories/recipe-repository";
import { useSession } from "@/lib/auth/use-session";

/**
 * useRecipes — Slice 6.4. Lists recipes visible to the current user
 * (own + system). Mirrors `useGenerations` shape: { data, isLoading,
 * error, refresh }.
 */

export interface UseRecipesResult {
  data: RecipeRecord[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useRecipes(
  partial: Partial<RecipeFilter> = {},
): UseRecipesResult {
  const { user } = useSession();
  const [data, setData] = useState<RecipeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(async () => {
    setRefreshTick((n) => n + 1);
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!user) {
      setData([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const rows = await getRecipeRepository().list({
          ownerId: user.id,
          includeSystem: true,
          ...partial,
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
  }, [user?.id, partial.category, partial.limit, refreshTick]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  return { data, isLoading, error, refresh };
}
