import { describe, expect, it } from "vitest";

import { assistantPlanSchema } from "@/lib/assistant/types";

describe("assistantPlanSchema", () => {
  it("accepts a complete Soul Image Burst plan", () => {
    const result = assistantPlanSchema.safeParse({
      reasoning: "Loading Soul Image Burst with your prompt + Soul ID.",
      steps: [
        { kind: "clear-canvas" },
        {
          kind: "instantiate-recipe",
          recipeId: "11111111-2222-3333-4444-555555555555",
          position: { x: 100, y: 100 },
        },
        {
          kind: "set-node-config",
          nodeId: "text-prompt",
          config: { text: "a tokyo skyline" },
        },
        {
          kind: "link-soul-id",
          nodeId: "soul-id",
          assetId: "asset-uuid-1",
        },
        { kind: "run" },
      ],
      estimatedCostUsd: 0.1,
      confirmation: "Run plan?",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown step kinds", () => {
    const result = assistantPlanSchema.safeParse({
      reasoning: "weird step",
      steps: [{ kind: "unleash-the-cat" } as never],
      estimatedCostUsd: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative cost", () => {
    const result = assistantPlanSchema.safeParse({
      reasoning: "no",
      steps: [],
      estimatedCostUsd: -1,
    });
    expect(result.success).toBe(false);
  });

  it("estimatedCostUsd defaults to 0 when omitted", () => {
    const result = assistantPlanSchema.safeParse({
      reasoning: "ok",
      steps: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.estimatedCostUsd).toBe(0);
    }
  });

  it("instantiate-recipe defaults position to (100, 100) when omitted", () => {
    const result = assistantPlanSchema.safeParse({
      reasoning: "drop",
      steps: [
        {
          kind: "instantiate-recipe",
          recipeId: "11111111-2222-3333-4444-555555555555",
        },
      ],
      estimatedCostUsd: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const step = result.data.steps[0];
      if (step?.kind === "instantiate-recipe") {
        expect(step.position).toEqual({ x: 100, y: 100 });
      }
    }
  });
});
