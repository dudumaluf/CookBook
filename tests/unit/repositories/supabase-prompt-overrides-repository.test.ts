import { describe, expect, it } from "vitest";

import { SupabasePromptOverridesRepository } from "@/lib/repositories/supabase-prompt-overrides-repository";

interface QueryState {
  filters: Array<{ col: string; val: unknown }>;
  upsertPayload: unknown;
  upsertOptions: unknown;
  deleted: boolean;
  ordered: boolean;
}

function makeMockClient(
  handler: (state: QueryState, finalizer: "list" | "single" | "delete") => unknown,
) {
  const state: QueryState = {
    filters: [],
    upsertPayload: undefined,
    upsertOptions: undefined,
    deleted: false,
    ordered: false,
  };
  function chain() {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => {
      state.filters.push({ col, val });
      return builder;
    };
    builder.order = () => {
      state.ordered = true;
      return Promise.resolve(handler(state, "list"));
    };
    builder.maybeSingle = async () => handler(state, "single");
    builder.single = async () => handler(state, "single");
    builder.upsert = (payload: unknown, options: unknown) => {
      state.upsertPayload = payload;
      state.upsertOptions = options;
      return builder;
    };
    builder.delete = () => {
      state.deleted = true;
      return builder;
    };
    builder.then = (resolve: (v: unknown) => void) =>
      resolve(handler(state, "delete"));
    return builder;
  }
  return { from: () => chain() };
}

describe("SupabasePromptOverridesRepository", () => {
  it("list returns empty array when no rows", async () => {
    const client = makeMockClient(() => ({ data: [], error: null }));
    const repo = new SupabasePromptOverridesRepository(client as never);
    const rows = await repo.list("u1");
    expect(rows).toEqual([]);
  });

  it("list maps to camelCase records", async () => {
    const client = makeMockClient(() => ({
      data: [
        {
          owner_id: "u1",
          prompt_key: "assistant.reasoner",
          body: "Custom body",
          created_at: "2026-06-02T00:00:00Z",
          updated_at: "2026-06-02T01:00:00Z",
        },
      ],
      error: null,
    }));
    const repo = new SupabasePromptOverridesRepository(client as never);
    const rows = await repo.list("u1");
    expect(rows).toEqual([
      {
        ownerId: "u1",
        promptKey: "assistant.reasoner",
        body: "Custom body",
        createdAt: "2026-06-02T00:00:00Z",
        updatedAt: "2026-06-02T01:00:00Z",
      },
    ]);
  });

  it("get returns null when no row", async () => {
    const client = makeMockClient(() => ({ data: null, error: null }));
    const repo = new SupabasePromptOverridesRepository(client as never);
    const result = await repo.get("u1", "assistant.reasoner");
    expect(result).toBeNull();
  });

  it("get filters by owner + prompt key", async () => {
    let capturedState: QueryState | undefined;
    const client = makeMockClient((state) => {
      capturedState = state;
      return {
        data: {
          owner_id: "u1",
          prompt_key: "assistant.reasoner",
          body: "X",
          created_at: "2026-06-02T00:00:00Z",
          updated_at: "2026-06-02T01:00:00Z",
        },
        error: null,
      };
    });
    const repo = new SupabasePromptOverridesRepository(client as never);
    await repo.get("u1", "assistant.reasoner");
    expect(capturedState?.filters).toEqual([
      { col: "owner_id", val: "u1" },
      { col: "prompt_key", val: "assistant.reasoner" },
    ]);
  });

  it("upsert sends owner_id + prompt_key + body with correct conflict target", async () => {
    let capturedPayload: unknown;
    let capturedOptions: unknown;
    const client = makeMockClient((state) => {
      if (state.upsertPayload !== undefined) {
        capturedPayload = state.upsertPayload;
        capturedOptions = state.upsertOptions;
      }
      return {
        data: {
          owner_id: "u1",
          prompt_key: "assistant.reasoner",
          body: "Custom body",
          created_at: "2026-06-02T00:00:00Z",
          updated_at: "2026-06-02T01:00:00Z",
        },
        error: null,
      };
    });
    const repo = new SupabasePromptOverridesRepository(client as never);
    const result = await repo.upsert("u1", "assistant.reasoner", "Custom body");
    expect(capturedPayload).toEqual({
      owner_id: "u1",
      prompt_key: "assistant.reasoner",
      body: "Custom body",
    });
    expect(capturedOptions).toEqual({ onConflict: "owner_id,prompt_key" });
    expect(result.body).toBe("Custom body");
  });

  it("remove issues a delete filtered by owner + key", async () => {
    let capturedState: QueryState | undefined;
    const client = makeMockClient((state) => {
      capturedState = state;
      return { error: null };
    });
    const repo = new SupabasePromptOverridesRepository(client as never);
    await repo.remove("u1", "assistant.reasoner");
    expect(capturedState?.deleted).toBe(true);
    expect(capturedState?.filters).toEqual([
      { col: "owner_id", val: "u1" },
      { col: "prompt_key", val: "assistant.reasoner" },
    ]);
  });
});
