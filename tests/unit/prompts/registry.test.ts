import { describe, expect, it } from "vitest";

import {
  getCodePrompts,
  PROMPT_KEYS,
} from "@/lib/prompts/registry";

describe("prompts registry", () => {
  it("returns at least the assistant base prompt", () => {
    const prompts = getCodePrompts();
    expect(prompts.length).toBeGreaterThan(0);
    const reasoner = prompts.find((p) => p.key === PROMPT_KEYS.ASSISTANT_REASONER);
    expect(reasoner).toBeDefined();
    expect(reasoner?.section).toBe("assistant");
    expect(reasoner?.title).toMatch(/assistant/i);
    expect(reasoner?.content.length).toBeGreaterThan(100);
  });

  it("description fields are human-readable, not technical jargon", () => {
    for (const prompt of getCodePrompts()) {
      // Every entry must have a description longer than a stub.
      expect(prompt.description.length).toBeGreaterThan(20);
      // No raw symbol names in the description (proxy for "no jargon").
      expect(prompt.description).not.toMatch(/REASONER_INSTRUCTIONS|JSONB|configParam/i);
    }
  });

  it("keys are stable + unique across the registry", () => {
    const prompts = getCodePrompts();
    const keys = new Set<string>();
    for (const prompt of prompts) {
      expect(keys.has(prompt.key)).toBe(false);
      keys.add(prompt.key);
    }
  });
});
