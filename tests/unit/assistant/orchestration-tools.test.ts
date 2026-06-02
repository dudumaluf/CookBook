import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  scoreRecipesForIntent,
  suggestRecipesForIntentTool,
} from "@/lib/assistant/tools/recipe/suggest-recipes-for-intent";
import { switchRoleTool } from "@/lib/assistant/tools/reasoning/switch-role";
import { useAssistantRoleStore } from "@/lib/stores/assistant-role-store";

const listMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({ list: listMock }),
  SupabaseRecipeRepository: class {},
}));

beforeEach(() => {
  listMock.mockReset();
  useAssistantRoleStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scoreRecipesForIntent (Phase E pure scorer)", () => {
  const recipes = [
    {
      id: "r1",
      name: "Storyboard Director",
      description: "Multi-panel storyboard prompt with continuity rules.",
      category: "describe",
      ownerId: null,
    },
    {
      id: "r2",
      name: "Simple Scene Prompter",
      description: "Single-shot scene prompt — subject, camera, audio.",
      category: "describe",
      ownerId: null,
    },
    {
      id: "r3",
      name: "Timeline Director",
      description: "Multi-beat timed scene prompt for video models.",
      category: "describe",
      ownerId: null,
    },
  ];

  it("returns empty when no tokens overlap", () => {
    const out = scoreRecipesForIntent(
      recipes,
      "render the user a coffee",
      5,
    );
    expect(out).toEqual([]);
  });

  it("ranks name matches above description matches", () => {
    const out = scoreRecipesForIntent(
      recipes,
      "I want a storyboard for my new ad",
      5,
    );
    expect(out[0]?.recipeId).toBe("r1");
    expect(out[0]?.matched).toContain("storyboard");
  });

  it("respects the limit", () => {
    const out = scoreRecipesForIntent(
      recipes,
      "scene storyboard timeline",
      2,
    );
    expect(out.length).toBe(2);
  });

  it("filters out unknown stopwords from the user message", () => {
    const out = scoreRecipesForIntent(
      recipes,
      "I want to make a storyboard",
      5,
    );
    expect(out[0]?.matched).not.toContain("the");
    expect(out[0]?.matched).not.toContain("want");
  });
});

describe("suggest_recipes_for_intent tool", () => {
  it("returns scored suggestions + role hints derived from matched tokens", async () => {
    listMock.mockResolvedValue([
      {
        id: "r1",
        name: "Storyboard Director",
        description: "Multi-panel storyboard prompt.",
        category: "describe",
        ownerId: null,
      },
    ]);
    const result = (await suggestRecipesForIntentTool.execute(
      { userMessage: "make me a storyboard" },
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    const suggestions = result.suggestions as Array<{ recipeId: string }>;
    expect(suggestions[0]?.recipeId).toBe("r1");
    const hints = result.roleHints as string[];
    expect(hints.some((h) => h.includes("storyboard-director"))).toBe(true);
  });

  it("returns empty suggestions + a 'fall back to construct' hint when nothing matches", async () => {
    listMock.mockResolvedValue([
      {
        id: "r1",
        name: "Storyboard Director",
        description: "Multi-panel storyboard prompt.",
        category: "describe",
        ownerId: null,
      },
    ]);
    const result = (await suggestRecipesForIntentTool.execute(
      { userMessage: "render a coffee for me" },
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect((result.suggestions as unknown[]).length).toBe(0);
    expect((result.hint as string).toLowerCase()).toContain(
      "no recipe matched",
    );
  });

  it("includes the known-roles list so the assistant has an inventory to choose from", async () => {
    listMock.mockResolvedValue([]);
    const result = (await suggestRecipesForIntentTool.execute(
      { userMessage: "anything" },
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    const known = result.knownRoles as Array<{ id: string }>;
    const ids = known.map((r) => r.id).sort();
    expect(ids).toEqual([
      "general",
      "prompt-engineer",
      "recipe-architect",
      "storyboard-director",
      "timeline-director",
    ]);
  });
});

describe("switch_role tool", () => {
  it("rejects unknown role ids and returns the known-roles list", async () => {
    const result = (await switchRoleTool.execute(
      { to: "wizard-of-oz", reason: "magic" },
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect((result.error as string).toLowerCase()).toContain("unknown role");
    expect(Array.isArray(result.knownRoles)).toBe(true);
  });

  it("switches to a known role and persists in the role store", async () => {
    const result = (await switchRoleTool.execute(
      {
        to: "storyboard-director",
        reason: "User asked for an 8-panel storyboard.",
      },
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.switched).toBe(true);
    expect(result.from).toBe("general");
    expect(result.to).toBe("storyboard-director");
    expect(useAssistantRoleStore.getState().getRoleId()).toBe(
      "storyboard-director",
    );
  });

  it("is idempotent — switching to the active role is a no-op", async () => {
    useAssistantRoleStore.getState().setRoleId("prompt-engineer");
    const result = (await switchRoleTool.execute(
      { to: "prompt-engineer", reason: "already there" },
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.switched).toBe(false);
    expect(useAssistantRoleStore.getState().getRoleId()).toBe(
      "prompt-engineer",
    );
  });

  it("zod-validates required args", async () => {
    await expect(
      switchRoleTool.execute(
        { to: "storyboard-director" },
        { ownerId: "u1" },
      ),
    ).rejects.toThrow();
  });
});
