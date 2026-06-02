import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REASONER_INSTRUCTIONS } from "@/lib/assistant/instructions";
import { resolvePrompt, getResolvedPromptBody } from "@/lib/prompts/resolve-prompt";
import { PROMPT_KEYS } from "@/lib/prompts/registry";
import type { PromptOverridesRepository } from "@/lib/repositories/prompt-overrides-repository";
import { setPromptOverridesRepositoryForTests } from "@/lib/repositories/supabase-prompt-overrides-repository";

function makeFakeRepo(
  rows: Record<string, { body: string; updatedAt: string }>,
  opts: { throwOnGet?: boolean } = {},
): PromptOverridesRepository {
  return {
    async list(ownerId) {
      return Object.entries(rows).map(([key, v]) => ({
        ownerId,
        promptKey: key,
        body: v.body,
        createdAt: v.updatedAt,
        updatedAt: v.updatedAt,
      }));
    },
    async get(ownerId, promptKey) {
      if (opts.throwOnGet) throw new Error("network down");
      const v = rows[promptKey];
      if (!v) return null;
      return {
        ownerId,
        promptKey,
        body: v.body,
        createdAt: v.updatedAt,
        updatedAt: v.updatedAt,
      };
    },
    async upsert(ownerId, promptKey, body) {
      rows[promptKey] = { body, updatedAt: "now" };
      return {
        ownerId,
        promptKey,
        body,
        createdAt: "now",
        updatedAt: "now",
      };
    },
    async remove(_ownerId, promptKey) {
      delete rows[promptKey];
    },
  };
}

describe("resolvePrompt", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    setPromptOverridesRepositoryForTests(undefined as never);
    vi.restoreAllMocks();
  });

  it("returns the bundled default when ownerId is null", async () => {
    setPromptOverridesRepositoryForTests(makeFakeRepo({}));
    const r = await resolvePrompt(PROMPT_KEYS.ASSISTANT_REASONER, null);
    expect(r.isOverride).toBe(false);
    expect(r.content).toBe(REASONER_INSTRUCTIONS);
    expect(r.defaultContent).toBe(REASONER_INSTRUCTIONS);
    expect(r.updatedAt).toBeNull();
  });

  it("returns the bundled default when no override row exists", async () => {
    setPromptOverridesRepositoryForTests(makeFakeRepo({}));
    const r = await resolvePrompt(PROMPT_KEYS.ASSISTANT_REASONER, "u1");
    expect(r.isOverride).toBe(false);
    expect(r.content).toBe(REASONER_INSTRUCTIONS);
  });

  it("returns the override body when one exists", async () => {
    setPromptOverridesRepositoryForTests(
      makeFakeRepo({
        [PROMPT_KEYS.ASSISTANT_REASONER]: {
          body: "MY CUSTOM BODY",
          updatedAt: "2026-06-02T01:00:00Z",
        },
      }),
    );
    const r = await resolvePrompt(PROMPT_KEYS.ASSISTANT_REASONER, "u1");
    expect(r.isOverride).toBe(true);
    expect(r.content).toBe("MY CUSTOM BODY");
    expect(r.defaultContent).toBe(REASONER_INSTRUCTIONS);
    expect(r.updatedAt).toBe("2026-06-02T01:00:00Z");
  });

  it("fails open — falls back to default when the repo throws", async () => {
    setPromptOverridesRepositoryForTests(
      makeFakeRepo({}, { throwOnGet: true }),
    );
    const r = await resolvePrompt(PROMPT_KEYS.ASSISTANT_REASONER, "u1");
    expect(r.isOverride).toBe(false);
    expect(r.content).toBe(REASONER_INSTRUCTIONS);
  });

  it("returns empty content for unknown prompt keys (no default registered)", async () => {
    setPromptOverridesRepositoryForTests(makeFakeRepo({}));
    const r = await resolvePrompt("unknown.key", "u1");
    expect(r.content).toBe("");
    expect(r.defaultContent).toBe("");
  });

  it("getResolvedPromptBody returns the content directly", async () => {
    setPromptOverridesRepositoryForTests(
      makeFakeRepo({
        [PROMPT_KEYS.ASSISTANT_REASONER]: { body: "X", updatedAt: "now" },
      }),
    );
    const body = await getResolvedPromptBody(
      PROMPT_KEYS.ASSISTANT_REASONER,
      "u1",
    );
    expect(body).toBe("X");
  });
});
