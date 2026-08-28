import { describe, expect, it } from "vitest";

import { buildH3MaxInput } from "@/lib/fal/h3-max-input";

describe("buildH3MaxInput", () => {
  it("maps camelCase to Fal snake_case with defaults", () => {
    expect(
      buildH3MaxInput({
        prompt: "pull back",
        imageUrl: "https://x/start.png",
      }),
    ).toEqual({
      prompt: "pull back",
      image_url: "https://x/start.png",
      duration: 5,
      resolution: "768P",
      prompt_expansion_mode: "balanced",
      enable_safety_checker: true,
    });
  });

  it("includes optional end frame + seed when set", () => {
    const input = buildH3MaxInput({
      prompt: "x",
      imageUrl: "https://x/a.png",
      endImageUrl: "https://x/b.png",
      duration: 10,
      resolution: "480P",
      promptExpansionMode: "disabled",
      enableSafetyChecker: false,
      seed: 42,
    });
    expect(input.end_image_url).toBe("https://x/b.png");
    expect(input.seed).toBe(42);
    expect(input.duration).toBe(10);
    expect(input.resolution).toBe("480P");
    expect(input.prompt_expansion_mode).toBe("disabled");
    expect(input.enable_safety_checker).toBe(false);
  });
});
