import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REASONER_INSTRUCTIONS } from "@/lib/assistant/instructions";
import { proposePromptEditTool } from "@/lib/assistant/tools/reasoning/propose-prompt-edit";
import { readMySystemPromptTool } from "@/lib/assistant/tools/reasoning/read-my-system-prompt";
import { setPromptOverridesRepositoryForTests } from "@/lib/repositories/supabase-prompt-overrides-repository";
import { useAssistantRoleStore } from "@/lib/stores/assistant-role-store";

const fakeRows = new Map<string, { body: string; updatedAt: string }>();

beforeEach(() => {
  fakeRows.clear();
  useAssistantRoleStore.getState().reset();
  setPromptOverridesRepositoryForTests({
    list: async () => Array.from(fakeRows.entries()).map(([k, v]) => ({
      ownerId: "u1",
      promptKey: k,
      body: v.body,
      createdAt: v.updatedAt,
      updatedAt: v.updatedAt,
    })),
    get: async (_owner, key) => {
      const v = fakeRows.get(key);
      if (!v) return null;
      return {
        ownerId: "u1",
        promptKey: key,
        body: v.body,
        createdAt: v.updatedAt,
        updatedAt: v.updatedAt,
      };
    },
    upsert: async (_owner, key, body) => {
      fakeRows.set(key, { body, updatedAt: "now" });
      return {
        ownerId: "u1",
        promptKey: key,
        body,
        createdAt: "now",
        updatedAt: "now",
      };
    },
    remove: async (_owner, key) => {
      fakeRows.delete(key);
    },
  });
});

afterEach(() => {
  setPromptOverridesRepositoryForTests(undefined as never);
  vi.restoreAllMocks();
});

describe("read_my_system_prompt", () => {
  it("returns the bundled default body when no override exists", async () => {
    const result = (await readMySystemPromptTool.execute(
      {},
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.isOverride).toBe(false);
    expect(result.body).toBe(REASONER_INSTRUCTIONS);
    expect(result.defaultBody).toBe(REASONER_INSTRUCTIONS);
    expect(result.promptKey).toBe("assistant.reasoner");
  });

  it("returns the override body when one is active", async () => {
    fakeRows.set("assistant.reasoner", {
      body: "MY OPS",
      updatedAt: "2026-06-02T01:00:00Z",
    });
    const result = (await readMySystemPromptTool.execute(
      {},
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    expect(result.isOverride).toBe(true);
    expect(result.body).toBe("MY OPS");
    expect(result.defaultBody).toBe(REASONER_INSTRUCTIONS);
    expect(result.updatedAt).toBe("2026-06-02T01:00:00Z");
  });

  it("includes the active role label and overlay", async () => {
    useAssistantRoleStore.getState().setRoleId("storyboard-director");
    const result = (await readMySystemPromptTool.execute(
      {},
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    expect(result.roleId).toBe("storyboard-director");
    expect(result.roleLabel).toBe("Storyboard Director");
    expect(typeof result.roleOverlay).toBe("string");
    expect((result.roleOverlay as string).length).toBeGreaterThan(0);
  });

  it("works without an authenticated owner — returns defaults + 'general' role", async () => {
    const result = (await readMySystemPromptTool.execute({}, {})) as Record<
      string,
      unknown
    >;
    expect(result.isOverride).toBe(false);
    expect(result.body).toBe(REASONER_INSTRUCTIONS);
    expect(result.roleId).toBe("general");
  });
});

describe("propose_prompt_edit", () => {
  it("rejects unknown / non-overridable prompt keys", async () => {
    const result = (await proposePromptEditTool.execute(
      {
        promptKey: "not.a.key",
        newBody: "X",
        rationale: "y",
      },
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect((result.error as string).toLowerCase()).toContain("not user-overridable");
  });

  it("returns a structured proposal with __proposal sentinel + diff summary", async () => {
    const result = (await proposePromptEditTool.execute(
      {
        promptKey: "assistant.reasoner",
        newBody: REASONER_INSTRUCTIONS + "\n\nExtra: be even more concise.",
        rationale: "User asked me to be more concise.",
      },
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.__proposal).toBe("prompt_edit");
    expect(result.promptKey).toBe("assistant.reasoner");
    expect(result.currentIsOverride).toBe(false);
    expect(result.currentBody).toBe(REASONER_INSTRUCTIONS);
    const summary = result.summary as Record<string, unknown>;
    expect(summary.charDelta).toBeGreaterThan(0);
    expect(summary.lineDelta).toBeGreaterThanOrEqual(0);
    expect(typeof summary.preview).toBe("string");
  });

  it("does NOT write to the override store (Apply lives in the UI)", async () => {
    await proposePromptEditTool.execute(
      {
        promptKey: "assistant.reasoner",
        newBody: "X",
        rationale: "y",
      },
      { ownerId: "u1" },
    );
    expect(fakeRows.size).toBe(0);
  });

  it("computes diff against the current OVERRIDE body when one is active", async () => {
    fakeRows.set("assistant.reasoner", {
      body: "ABC",
      updatedAt: "now",
    });
    const result = (await proposePromptEditTool.execute(
      {
        promptKey: "assistant.reasoner",
        newBody: "ABCDEF",
        rationale: "extend",
      },
      { ownerId: "u1" },
    )) as Record<string, unknown>;
    expect(result.currentBody).toBe("ABC");
    expect(result.currentIsOverride).toBe(true);
    const summary = result.summary as { charDelta: number };
    expect(summary.charDelta).toBe(3);
  });

  it("validates required arguments (Zod throws on missing fields)", async () => {
    await expect(
      proposePromptEditTool.execute(
        { promptKey: "assistant.reasoner", newBody: "X" },
        { ownerId: "u1" },
      ),
    ).rejects.toThrow();
  });
});
