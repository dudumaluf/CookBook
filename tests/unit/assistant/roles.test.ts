import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROLE_ID,
  GENERAL_ROLE,
  PROMPT_ENGINEER_ROLE,
  RECIPE_ARCHITECT_ROLE,
  ROLES,
  resolveRole,
  STORYBOARD_DIRECTOR_ROLE,
  TIMELINE_DIRECTOR_ROLE,
} from "@/lib/assistant/roles";

/**
 * Phase D1 — role registry contract.
 *
 * The reasoner reads through this registry every turn, so every role
 * needs a stable, well-formed entry. Tests pin the contract so a
 * future role addition can't accidentally ship malformed.
 */

describe("ROLES registry", () => {
  it("starts with the General role at index 0 (resolveRole's fallback)", () => {
    expect(ROLES[0]?.id).toBe("general");
    expect(ROLES[0]).toBe(GENERAL_ROLE);
  });

  it("contains exactly the five Phase D1 roles", () => {
    const ids = ROLES.map((r) => r.id).sort();
    expect(ids).toEqual([
      "general",
      "prompt-engineer",
      "recipe-architect",
      "storyboard-director",
      "timeline-director",
    ]);
  });

  it("has unique role ids (no duplicate registrations)", () => {
    const ids = ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every role declares id + label + description", () => {
    for (const role of ROLES) {
      expect(role.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(role.label.length).toBeGreaterThan(0);
      expect(role.description.length).toBeGreaterThan(0);
    }
  });

  it("General has a non-empty overlay (Phase E orchestrator nudge)", () => {
    expect(GENERAL_ROLE.systemPromptOverlay.length).toBeGreaterThan(100);
    expect(GENERAL_ROLE.systemPromptOverlay).toMatch(/General — Orchestrator/);
    expect(GENERAL_ROLE.systemPromptOverlay).toMatch(
      /suggest_recipes_for_intent/,
    );
    expect(GENERAL_ROLE.systemPromptOverlay).toMatch(/switch_role/);
  });

  it("every specialist role has a non-empty overlay", () => {
    const specialists = ROLES.filter((r) => r.id !== "general");
    for (const role of specialists) {
      expect(role.systemPromptOverlay.length).toBeGreaterThan(100);
    }
  });

  it("every role's overlay starts with a clear ROLE OVERLAY heading", () => {
    for (const role of ROLES) {
      expect(role.systemPromptOverlay).toMatch(/^## ROLE OVERLAY: /);
    }
  });
});

describe("resolveRole", () => {
  it("returns General for null / undefined / empty inputs", () => {
    expect(resolveRole(null)).toBe(GENERAL_ROLE);
    expect(resolveRole(undefined)).toBe(GENERAL_ROLE);
    expect(resolveRole("")).toBe(GENERAL_ROLE);
  });

  it("returns the registered role for a known id", () => {
    expect(resolveRole("prompt-engineer")).toBe(PROMPT_ENGINEER_ROLE);
    expect(resolveRole("storyboard-director")).toBe(STORYBOARD_DIRECTOR_ROLE);
    expect(resolveRole("timeline-director")).toBe(TIMELINE_DIRECTOR_ROLE);
    expect(resolveRole("recipe-architect")).toBe(RECIPE_ARCHITECT_ROLE);
  });

  it("falls back to General for an unknown id (e.g. dropped role)", () => {
    expect(resolveRole("not-a-real-role")).toBe(GENERAL_ROLE);
    expect(resolveRole("storyboardirector")).toBe(GENERAL_ROLE); // typo
  });

  it("DEFAULT_ROLE_ID matches General", () => {
    expect(DEFAULT_ROLE_ID).toBe("general");
    expect(resolveRole(DEFAULT_ROLE_ID)).toBe(GENERAL_ROLE);
  });
});
