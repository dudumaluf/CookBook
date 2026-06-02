import { beforeEach, describe, expect, it } from "vitest";

import {
  getActiveRole,
  getActiveRoleOverlay,
  useAssistantRoleStore,
} from "@/lib/stores/assistant-role-store";

beforeEach(() => {
  // Reset to default before each test — Zustand's persist middleware
  // doesn't auto-reset between tests.
  useAssistantRoleStore.getState().reset();
  localStorage.clear();
});

describe("useAssistantRoleStore", () => {
  it("starts with the General role as default", () => {
    expect(useAssistantRoleStore.getState().roleId).toBe("general");
    expect(useAssistantRoleStore.getState().getRoleId()).toBe("general");
  });

  it("setRoleId persists the new role id", () => {
    useAssistantRoleStore.getState().setRoleId("storyboard-director");
    expect(useAssistantRoleStore.getState().roleId).toBe("storyboard-director");
  });

  it("setRoleId trims whitespace; empty input resets to General (defensive)", () => {
    useAssistantRoleStore.getState().setRoleId("  prompt-engineer  ");
    expect(useAssistantRoleStore.getState().roleId).toBe("prompt-engineer");
    useAssistantRoleStore.getState().setRoleId("");
    expect(useAssistantRoleStore.getState().roleId).toBe("general");
    useAssistantRoleStore.getState().setRoleId("   ");
    expect(useAssistantRoleStore.getState().roleId).toBe("general");
  });

  it("reset returns to General regardless of current role", () => {
    useAssistantRoleStore.getState().setRoleId("recipe-architect");
    useAssistantRoleStore.getState().reset();
    expect(useAssistantRoleStore.getState().roleId).toBe("general");
  });

  it("getRole returns the active role record (resolved through registry)", () => {
    useAssistantRoleStore.getState().setRoleId("timeline-director");
    const role = useAssistantRoleStore.getState().getRole();
    expect(role.id).toBe("timeline-director");
    expect(role.label).toBe("Timeline Director");
    expect(role.systemPromptOverlay).toMatch(/Timeline Director/);
  });

  it("getRole falls back to General for a stale id no longer in the registry", () => {
    // Simulate a future release that dropped the role.
    useAssistantRoleStore.setState({ roleId: "the-removed-one" });
    const role = useAssistantRoleStore.getState().getRole();
    expect(role.id).toBe("general");
  });
});

describe("getActiveRoleOverlay / getActiveRole helpers", () => {
  it("returns the empty string for the default General role", () => {
    expect(getActiveRoleOverlay()).toBe("");
  });

  it("returns a non-empty overlay for a specialist role", () => {
    useAssistantRoleStore.getState().setRoleId("storyboard-director");
    const overlay = getActiveRoleOverlay();
    expect(overlay.length).toBeGreaterThan(100);
    expect(overlay).toMatch(/ROLE OVERLAY/);
  });

  it("getActiveRole returns the resolved role record", () => {
    useAssistantRoleStore.getState().setRoleId("recipe-architect");
    const role = getActiveRole();
    expect(role.id).toBe("recipe-architect");
  });

  it("getActiveRoleOverlay reflects role switches synchronously (no subscription delay)", () => {
    useAssistantRoleStore.getState().setRoleId("prompt-engineer");
    const a = getActiveRoleOverlay();
    useAssistantRoleStore.getState().setRoleId("timeline-director");
    const b = getActiveRoleOverlay();
    expect(a).not.toBe(b);
    expect(a).toMatch(/Prompt Engineer/);
    expect(b).toMatch(/Timeline Director/);
  });
});
