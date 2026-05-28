import { describe, expect, it } from "vitest";

import {
  RECIPE_DRAG_MIME,
  parseRecipeDrag,
  serializeRecipeDrag,
} from "@/lib/library/recipe-drag";

describe("recipe-drag", () => {
  it("MIME is the cookbook-namespaced recipe type", () => {
    expect(RECIPE_DRAG_MIME).toBe("application/x-cookbook-recipe");
  });

  it("serialize / parse roundtrips a node-mode payload", () => {
    const wire = serializeRecipeDrag({ recipeId: "r1", mode: "node" });
    const parsed = parseRecipeDrag(wire);
    expect(parsed?.recipeId).toBe("r1");
    expect(parsed?.mode).toBe("node");
  });

  it("serialize / parse roundtrips an expand-mode payload", () => {
    const wire = serializeRecipeDrag({ recipeId: "r1", mode: "expand" });
    const parsed = parseRecipeDrag(wire);
    expect(parsed?.mode).toBe("expand");
  });

  it("returns null on malformed JSON", () => {
    expect(parseRecipeDrag("not-json")).toBeNull();
  });

  it("returns null on missing fields", () => {
    expect(parseRecipeDrag(JSON.stringify({}))).toBeNull();
    expect(
      parseRecipeDrag(JSON.stringify({ recipeId: "" })),
    ).toBeNull();
    expect(
      parseRecipeDrag(JSON.stringify({ recipeId: "r1", mode: "weird" })),
    ).toBeNull();
  });
});
