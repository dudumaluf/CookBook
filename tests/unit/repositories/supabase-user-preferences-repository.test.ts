import { describe, expect, it } from "vitest";

import { SupabaseUserPreferencesRepository } from "@/lib/repositories/supabase-user-preferences-repository";

interface QueryState {
  filters: Array<{ col: string; val: unknown }>;
  upsertPayload: unknown;
  upsertOptions: unknown;
}

function makeMockClient(handler: (state: QueryState) => unknown) {
  const state: QueryState = {
    filters: [],
    upsertPayload: undefined,
    upsertOptions: undefined,
  };
  function chain() {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => {
      state.filters.push({ col, val });
      return builder;
    };
    builder.maybeSingle = async () => handler(state);
    builder.single = async () => handler(state);
    builder.upsert = (payload: unknown, options: unknown) => {
      state.upsertPayload = payload;
      state.upsertOptions = options;
      return builder;
    };
    return builder;
  }
  return { from: () => chain() };
}

describe("SupabaseUserPreferencesRepository", () => {
  it("get returns null when no row", async () => {
    const client = makeMockClient(() => ({ data: null, error: null }));
    const repo = new SupabaseUserPreferencesRepository(client as never);
    const result = await repo.get("u1");
    expect(result).toBeNull();
  });

  it("get returns camelCase record when found", async () => {
    const client = makeMockClient(() => ({
      data: {
        owner_id: "u1",
        preferences: { aspect: "16:9" },
        updated_at: "2026-05-28T00:00:00Z",
      },
      error: null,
    }));
    const repo = new SupabaseUserPreferencesRepository(client as never);
    const result = await repo.get("u1");
    expect(result).toEqual({
      ownerId: "u1",
      preferences: { aspect: "16:9" },
      updatedAt: "2026-05-28T00:00:00Z",
    });
  });

  it("set upserts the full preferences blob", async () => {
    let captured: unknown;
    const client = makeMockClient((state) => {
      if (state.upsertPayload !== undefined) captured = state.upsertPayload;
      return {
        data: {
          owner_id: "u1",
          preferences: { aspect: "16:9", style: "noir" },
          updated_at: "2026-05-28T00:00:00Z",
        },
        error: null,
      };
    });
    const repo = new SupabaseUserPreferencesRepository(client as never);
    const result = await repo.set("u1", { aspect: "16:9", style: "noir" });
    expect(captured).toEqual({
      owner_id: "u1",
      preferences: { aspect: "16:9", style: "noir" },
    });
    expect(result.preferences).toEqual({ aspect: "16:9", style: "noir" });
  });

  it("patch shallow-merges + upserts", async () => {
    let upsertCalls = 0;
    let captured: unknown;
    const client = {
      from: () => {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.maybeSingle = async () => ({
          data: {
            owner_id: "u1",
            preferences: { aspect: "16:9", tone: "warm" },
            updated_at: "2026-05-27T00:00:00Z",
          },
          error: null,
        });
        builder.upsert = (payload: unknown) => {
          upsertCalls++;
          captured = payload;
          return builder;
        };
        builder.single = async () => ({
          data: {
            owner_id: "u1",
            preferences: { aspect: "16:9", style: "noir" },
            updated_at: "2026-05-28T00:00:00Z",
          },
          error: null,
        });
        return builder;
      },
    };
    const repo = new SupabaseUserPreferencesRepository(client as never);
    const result = await repo.patch("u1", { style: "noir", tone: null });
    expect(upsertCalls).toBe(1);
    // tone: null deletes the key; style adds new; aspect keeps.
    expect((captured as { preferences: Record<string, unknown> }).preferences)
      .toEqual({ aspect: "16:9", style: "noir" });
    expect(result.preferences).toEqual({ aspect: "16:9", style: "noir" });
  });
});
