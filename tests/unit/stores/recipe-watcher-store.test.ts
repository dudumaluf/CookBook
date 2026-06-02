import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "@testing-library/react";

const listMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({ list: listMock }),
}));

const {
  useRecipeWatcherStore,
  useRecipeCurrentVersion,
} = await import("@/lib/stores/recipe-watcher-store");

beforeEach(() => {
  useRecipeWatcherStore.setState({
    versions: new Map(),
    hydrated: false,
    refreshCycle: 0,
  });
});

afterEach(() => {
  listMock.mockReset();
});

describe("useRecipeWatcherStore", () => {
  it("starts un-hydrated with an empty version map", () => {
    const s = useRecipeWatcherStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.versions.size).toBe(0);
    expect(s.getVersion("anything")).toBe(null);
  });

  it("refresh() populates the map from the repository and flips hydrated", async () => {
    listMock.mockResolvedValue([
      { id: "r1", version: 3 },
      { id: "r2", version: 1 },
    ]);
    await useRecipeWatcherStore.getState().refresh({
      ownerId: "u1",
      includeSystem: true,
    });
    const s = useRecipeWatcherStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.getVersion("r1")).toBe(3);
    expect(s.getVersion("r2")).toBe(1);
    expect(s.getVersion("missing")).toBe(null);
  });

  it("refresh() bumps refreshCycle on every successful resolve", async () => {
    listMock.mockResolvedValue([]);
    expect(useRecipeWatcherStore.getState().refreshCycle).toBe(0);
    await useRecipeWatcherStore.getState().refresh({
      ownerId: null,
      includeSystem: true,
    });
    expect(useRecipeWatcherStore.getState().refreshCycle).toBe(1);
    await useRecipeWatcherStore.getState().refresh({
      ownerId: null,
      includeSystem: true,
    });
    expect(useRecipeWatcherStore.getState().refreshCycle).toBe(2);
  });

  it("refresh() coalesces concurrent calls into a single network request", async () => {
    listMock.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve([{ id: "r1", version: 1 }]), 10),
        ),
    );
    const a = useRecipeWatcherStore.getState().refresh({
      ownerId: null,
      includeSystem: true,
    });
    const b = useRecipeWatcherStore.getState().refresh({
      ownerId: null,
      includeSystem: true,
    });
    await Promise.all([a, b]);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("refresh() does NOT crash on a network error — just leaves the map unchanged", async () => {
    listMock.mockRejectedValue(new Error("rls denied"));
    await expect(
      useRecipeWatcherStore.getState().refresh({
        ownerId: "u1",
        includeSystem: true,
      }),
    ).resolves.toBeUndefined();
    // hydrated stays false on error so consumers don't show stale data.
    expect(useRecipeWatcherStore.getState().hydrated).toBe(false);
  });

  it("_seed() lets tests overwrite the map directly without hitting the repo", () => {
    useRecipeWatcherStore
      .getState()
      ._seed(new Map([["r1", 5]]));
    expect(useRecipeWatcherStore.getState().getVersion("r1")).toBe(5);
    expect(useRecipeWatcherStore.getState().hydrated).toBe(true);
  });
});

describe("useRecipeCurrentVersion (selector hook)", () => {
  it("returns null until the store hydrates", () => {
    const { result } = renderHook(() => useRecipeCurrentVersion("r1"));
    expect(result.current).toBe(null);
  });

  it("returns the stored version after seeding", () => {
    useRecipeWatcherStore.getState()._seed(new Map([["r1", 7]]));
    const { result } = renderHook(() => useRecipeCurrentVersion("r1"));
    expect(result.current).toBe(7);
  });

  it("returns null for null recipeId (no recipe to watch)", () => {
    useRecipeWatcherStore.getState()._seed(new Map([["r1", 7]]));
    const { result } = renderHook(() => useRecipeCurrentVersion(null));
    expect(result.current).toBe(null);
  });

  it("returns null for unknown recipeId even after hydration", () => {
    useRecipeWatcherStore.getState()._seed(new Map([["r1", 7]]));
    const { result } = renderHook(() => useRecipeCurrentVersion("r-other"));
    expect(result.current).toBe(null);
  });
});
