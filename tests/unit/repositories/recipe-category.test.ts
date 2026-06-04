import { describe, expect, it } from "vitest";

import {
  coerceRecipeCategory,
  RECIPE_CATEGORIES,
} from "@/lib/repositories/recipe-repository";

describe("RECIPE_CATEGORIES", () => {
  it("is the closed set the Add Node menu groups by", () => {
    expect([...RECIPE_CATEGORIES]).toEqual([
      "describe",
      "image",
      "video",
      "audio",
      "utility",
    ]);
  });
});

describe("coerceRecipeCategory()", () => {
  it("accepts every literal in RECIPE_CATEGORIES", () => {
    for (const c of RECIPE_CATEGORIES) {
      expect(coerceRecipeCategory(c)).toBe(c);
    }
  });

  it("returns null for null/undefined/non-string inputs", () => {
    expect(coerceRecipeCategory(null)).toBeNull();
    expect(coerceRecipeCategory(undefined)).toBeNull();
    // Force a non-string value (mirrors what an old DB row could surface).
    expect(coerceRecipeCategory(42 as unknown as string)).toBeNull();
  });

  it("returns null for unknown legacy strings (so Add Node lands them in 'uncategorized')", () => {
    // Legacy values shipped before the enum existed should be coerced to
    // null rather than narrowing them as if they were valid categories;
    // the bucket layer handles the null fallback.
    expect(coerceRecipeCategory("prompt-engineering")).toBeNull();
    expect(coerceRecipeCategory("")).toBeNull();
    expect(coerceRecipeCategory("IMAGE")).toBeNull(); // case-sensitive
  });
});
