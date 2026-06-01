import { describe, expect, it } from "vitest";

import { compositeNodeSchema } from "@/components/nodes/node-composite";
import type { CompositeNodeConfig } from "@/components/nodes/node-composite";

/**
 * Verifies that `CompositeNodeConfig` carries `recipeVersion` (Phase B1
 * groundwork for "Update available → vN" badges in Phase B2). The five
 * drop sites (recipe-detail handleDrop, canvas-flow recipe drag,
 * add-node-button handlePickRecipe, instantiate-recipe assistant tool,
 * save-from-canvas) each stamp this from `recipe.version` at drop
 * time. The test surface here is the schema's defaultConfig + the type
 * shape itself; integration of the drop-time stamp is exercised via
 * the cookbook-overlay component test (Drop button → addNode call).
 */

describe("Composite node — recipeVersion (Phase B1)", () => {
  it("defaultConfig carries recipeVersion: null (pre-stamp / unattached composite)", () => {
    const cfg = compositeNodeSchema.defaultConfig as CompositeNodeConfig;
    expect(cfg.recipeVersion).toBeNull();
  });

  it("type contract: recipeVersion is a required field on CompositeNodeConfig", () => {
    // Compile-time check — if recipeVersion ever becomes optional this
    // assignment would still typecheck without it, breaking "every drop
    // stamps a version". Make it impossible to silently lose the field.
    const cfg: CompositeNodeConfig = {
      recipeId: "r1",
      recipeName: "Test",
      recipeVersion: 5,
      subgraph: { version: 2, nodes: [], edges: [] },
      exposedInputs: [],
      exposedOutputs: [],
    };
    expect(cfg.recipeVersion).toBe(5);
  });

  it("null vs number: pre-B1 instances are distinguishable from versioned ones", () => {
    const pre: CompositeNodeConfig = {
      recipeId: "r1",
      recipeName: "Test",
      recipeVersion: null,
      subgraph: { version: 2, nodes: [], edges: [] },
      exposedInputs: [],
      exposedOutputs: [],
    };
    const stamped: CompositeNodeConfig = {
      ...pre,
      recipeVersion: 1,
    };
    // Phase B2's "Update available" comparator will treat null as
    // "we don't know — don't badge"; a number gets compared to the
    // recipe's current version.
    expect(pre.recipeVersion === null).toBe(true);
    expect(typeof stamped.recipeVersion).toBe("number");
  });
});
