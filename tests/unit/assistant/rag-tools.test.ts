import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";

const generationRepoMocks = {
  insert: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  get: vi.fn(),
  findSimilar: vi.fn().mockResolvedValue([]),
  setPinned: vi.fn(),
  setTitle: vi.fn(),
  setTags: vi.fn(),
  remove: vi.fn(),
  listForNode: vi.fn().mockResolvedValue([]),
};
vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => generationRepoMocks,
  SupabaseGenerationRepository: class {},
}));

const userPrefsRepoMocks = {
  get: vi.fn(),
  patch: vi.fn(),
  set: vi.fn(),
};
vi.mock("@/lib/repositories/supabase-user-preferences-repository", () => ({
  getUserPreferencesRepository: () => userPrefsRepoMocks,
  SupabaseUserPreferencesRepository: class {},
  setUserPreferencesRepositoryForTests: vi.fn(),
}));

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  }),
  SupabaseRecipeRepository: class {},
}));

const { getTool } = await import("@/lib/assistant/tools");

beforeEach(() => {
  Object.values(generationRepoMocks).forEach((m) => {
    if (typeof m.mockReset === "function") m.mockReset();
  });
  generationRepoMocks.findSimilar.mockResolvedValue([]);
  Object.values(userPrefsRepoMocks).forEach((m) => m.mockReset());
});

describe("find_similar_generations tool", () => {
  it("requires projectId in scope:project", async () => {
    const tool = getTool("find_similar_generations")!;
    const out = (await tool.execute(
      { query: "noir" },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/project/i);
  });

  it("forwards project-scoped search", async () => {
    generationRepoMocks.findSimilar.mockResolvedValue([
      {
        id: "g1",
        nodeKind: "higgsfield-image-gen",
        title: "noir 1",
        promptText: "film noir portrait",
        output: { type: "image", data: "https://x.test/a.png" },
        createdAt: "2026-05-26T12:00:00Z",
      },
    ]);
    const tool = getTool("find_similar_generations")!;
    const out = (await tool.execute(
      { query: "film noir", limit: 5 },
      { projectId: "p1", ownerId: "u1" },
    )) as { ok: boolean; count: number; generations: { id: string }[] };
    expect(out.ok).toBe(true);
    expect(out.count).toBe(1);
    expect(out.generations[0]?.id).toBe("g1");
    expect(generationRepoMocks.findSimilar).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "project",
        projectId: "p1",
        query: "film noir",
        limit: 5,
      }),
    );
  });

  it("scopes to owner across projects", async () => {
    generationRepoMocks.findSimilar.mockResolvedValue([]);
    const tool = getTool("find_similar_generations")!;
    await tool.execute(
      { query: "cinematic", scope: "owner" },
      { ownerId: "u1", projectId: "p1" },
    );
    expect(generationRepoMocks.findSimilar).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "owner",
        ownerId: "u1",
      }),
    );
  });
});

describe("read_user_preferences tool", () => {
  it("requires owner", async () => {
    const tool = getTool("read_user_preferences")!;
    const out = (await tool.execute({}, {})) as {
      ok: boolean;
      error?: string;
    };
    expect(out.ok).toBe(false);
  });

  it("returns preferences (or empty) when found", async () => {
    userPrefsRepoMocks.get.mockResolvedValue({
      ownerId: "u1",
      preferences: { aspect: "16:9" },
      updatedAt: "2026-05-28T00:00:00Z",
    });
    const tool = getTool("read_user_preferences")!;
    const out = (await tool.execute({}, { ownerId: "u1" })) as {
      ok: boolean;
      preferences: Record<string, unknown>;
    };
    expect(out.ok).toBe(true);
    expect(out.preferences).toEqual({ aspect: "16:9" });
  });

  it("returns empty preferences when no row exists yet", async () => {
    userPrefsRepoMocks.get.mockResolvedValue(null);
    const tool = getTool("read_user_preferences")!;
    const out = (await tool.execute({}, { ownerId: "u1" })) as {
      ok: boolean;
      preferences: Record<string, unknown>;
      updatedAt: string | null;
    };
    expect(out.ok).toBe(true);
    expect(out.preferences).toEqual({});
    expect(out.updatedAt).toBeNull();
  });
});

describe("update_user_preferences tool", () => {
  it("requires owner", async () => {
    const tool = getTool("update_user_preferences")!;
    const out = (await tool.execute(
      { patch: { aspect: "16:9" } },
      {},
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
  });

  it("calls patch and returns updated prefs", async () => {
    userPrefsRepoMocks.patch.mockResolvedValue({
      ownerId: "u1",
      preferences: { aspect: "16:9" },
      updatedAt: "2026-05-28T00:00:00Z",
    });
    const tool = getTool("update_user_preferences")!;
    const out = (await tool.execute(
      { patch: { aspect: "16:9" } },
      { ownerId: "u1" },
    )) as {
      ok: boolean;
      preferences: Record<string, unknown>;
    };
    expect(out.ok).toBe(true);
    expect(out.preferences).toEqual({ aspect: "16:9" });
    expect(userPrefsRepoMocks.patch).toHaveBeenCalledWith("u1", {
      aspect: "16:9",
    });
  });
});
