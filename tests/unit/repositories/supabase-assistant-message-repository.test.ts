import { describe, expect, it } from "vitest";

import { SupabaseAssistantMessageRepository } from "@/lib/repositories/supabase-assistant-message-repository";

interface QueryState {
  filters: Array<{ col: string; val: unknown }>;
  insertPayload: unknown;
  limitN: number | null;
}

function makeMockClient(handler: (state: QueryState) => unknown) {
  function chain(state: QueryState) {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => {
      state.filters.push({ col, val });
      return builder;
    };
    builder.order = () => builder;
    builder.limit = (n: number) => {
      state.limitN = n;
      return builder;
    };
    builder.single = async () => handler(state);
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(handler(state)).then(resolve);
    builder.insert = (payload: unknown) => {
      state.insertPayload = payload;
      return builder;
    };
    builder.delete = () => builder;
    return builder;
  }
  return {
    from: () => {
      const state: QueryState = {
        filters: [],
        insertPayload: undefined,
        limitN: null,
      };
      return chain(state);
    },
  };
}

const FAKE_ROW = {
  id: "msg-1",
  project_id: "p1",
  owner_id: "u1",
  role: "assistant",
  content: "raw response",
  plan: { reasoning: "ok", steps: [], estimatedCostUsd: 0 },
  error: null,
  cost_usd: "0.001500",
  created_at: "2026-05-28T00:00:00Z",
};

describe("SupabaseAssistantMessageRepository", () => {
  it("insert maps role/content/plan/cost into snake_case payload", async () => {
    let captured: unknown;
    const client = makeMockClient((state) => {
      if (state.insertPayload !== undefined) captured = state.insertPayload;
      return { data: FAKE_ROW, error: null };
    });
    const repo = new SupabaseAssistantMessageRepository(client as never);
    const out = await repo.insert({
      projectId: "p1",
      ownerId: "u1",
      role: "user",
      content: "hello",
      plan: null,
      costUsd: 0.0015,
    });
    expect((captured as { project_id: string }).project_id).toBe("p1");
    expect((captured as { role: string }).role).toBe("user");
    expect((captured as { cost_usd: number }).cost_usd).toBe(0.0015);
    // Returned record has costUsd coerced from string.
    expect(out.costUsd).toBeCloseTo(0.0015);
    expect(out.role).toBe("assistant");
  });

  it("listForProject filters by project_id and applies the limit", async () => {
    let capturedState: QueryState | null = null;
    const client = makeMockClient((state) => {
      capturedState = state;
      return [FAKE_ROW];
    });
    const repo = new SupabaseAssistantMessageRepository(client as never);
    await repo.listForProject("p1", 50);
    expect(capturedState).not.toBeNull();
    const projectFilter = capturedState!.filters.find(
      (f) => f.col === "project_id",
    );
    expect(projectFilter?.val).toBe("p1");
    expect(capturedState!.limitN).toBe(50);
  });

  it("clearForProject deletes by project_id", async () => {
    let capturedState: QueryState | null = null;
    const client = makeMockClient((state) => {
      capturedState = state;
      return { data: null, error: null };
    });
    const repo = new SupabaseAssistantMessageRepository(client as never);
    await repo.clearForProject("p1");
    expect(capturedState!.filters[0]).toEqual({
      col: "project_id",
      val: "p1",
    });
  });
});
