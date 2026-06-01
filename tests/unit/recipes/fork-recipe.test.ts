import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecipeRecord } from "@/lib/repositories/recipe-repository";

const saveMock = vi.fn();

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({ save: saveMock }),
}));

const { forkRecipe } = await import("@/lib/recipes/fork-recipe");

afterEach(() => {
  saveMock.mockReset();
});

function recipe(overrides: Partial<RecipeRecord> = {}): RecipeRecord {
  return {
    id: "r-source",
    ownerId: null,
    name: "Seedance Director",
    description: "Built-in",
    category: "video",
    subgraph: { version: 1, nodes: [], edges: [] },
    isNode: true,
    parentRecipeId: null,
    createdAt: "2026-06-01T00:00:00Z",
    version: 1,
    ...overrides,
  };
}

describe("forkRecipe", () => {
  it("creates a user-owned copy with parentRecipeId pointing at the source", async () => {
    saveMock.mockResolvedValue({ ...recipe(), id: "r-fork" });
    const source = recipe({ ownerId: null, name: "Original" });
    await forkRecipe({ source, ownerId: "user-1" });
    expect(saveMock).toHaveBeenCalledTimes(1);
    const arg = saveMock.mock.calls[0]![0];
    expect(arg.ownerId).toBe("user-1");
    expect(arg.parentRecipeId).toBe("r-source");
    expect(arg.name).toBe("Original (copy)");
  });

  it("preserves subgraph + isNode + description + category from the source", async () => {
    saveMock.mockResolvedValue(recipe());
    const source = recipe({
      description: "A neat little prompt director",
      category: "video",
      isNode: true,
      subgraph: {
        version: 2,
        nodes: [
          { id: "n", kind: "text", position: { x: 0, y: 0 }, config: { text: "" } },
        ],
        edges: [],
      },
    });
    await forkRecipe({ source, ownerId: "user-1" });
    const arg = saveMock.mock.calls[0]![0];
    expect(arg.subgraph).toBe(source.subgraph);
    expect(arg.isNode).toBe(true);
    expect(arg.description).toBe("A neat little prompt director");
    expect(arg.category).toBe("video");
  });

  it("supports a custom name suffix (used by the silent fork-on-edit flow)", async () => {
    saveMock.mockResolvedValue(recipe());
    const source = recipe({ name: "Pic Maker" });
    await forkRecipe({
      source,
      ownerId: "user-1",
      nameSuffix: " (your copy)",
    });
    const arg = saveMock.mock.calls[0]![0];
    expect(arg.name).toBe("Pic Maker (your copy)");
  });

  it("does NOT pass `id` so the row is inserted (not updated) — preserves v1 default", async () => {
    saveMock.mockResolvedValue(recipe());
    await forkRecipe({ source: recipe(), ownerId: "user-1" });
    const arg = saveMock.mock.calls[0]![0];
    expect(arg.id).toBeUndefined();
  });

  it("returns the new RecipeRecord exactly as the repository emits it", async () => {
    const persisted = recipe({ id: "r-fork", ownerId: "user-1", version: 1 });
    saveMock.mockResolvedValue(persisted);
    const result = await forkRecipe({ source: recipe(), ownerId: "user-1" });
    expect(result).toBe(persisted);
  });
});
