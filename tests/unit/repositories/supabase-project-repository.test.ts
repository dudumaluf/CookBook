import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseProjectRepository } from "@/lib/repositories/supabase-project-repository";
import { ProjectRepositoryError } from "@/lib/repositories/project-repository";

/**
 * Slice 6.1 — repository unit tests against a hand-rolled Supabase client
 * mock. We only exercise the surface our code uses (`from`, `select`, `eq`,
 * `single`, etc.) — keeps tests fast and avoids needing a real Postgres.
 */

interface QueryState {
  table: string;
  selectArgs: string | undefined;
  filters: Array<{ col: string; val: unknown }>;
  isFilters: Array<{ col: string; val: unknown }>;
  orderArgs: { col: string; opts: { ascending: boolean } } | undefined;
  limitN: number | undefined;
  resolveSingle: () => Promise<{ data: unknown; error: unknown }>;
  resolveMaybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  resolveList: () => Promise<{ data: unknown; error: unknown }>;
  insertPayload: unknown;
  updatePayload: unknown;
}

function makeMockClient(handler: (state: QueryState) => unknown) {
  function chain(state: QueryState) {
    const builder: Record<string, unknown> = {};
    builder.select = (args?: string) => {
      state.selectArgs = args;
      return builder;
    };
    builder.eq = (col: string, val: unknown) => {
      state.filters.push({ col, val });
      return builder;
    };
    builder.is = (col: string, val: unknown) => {
      state.isFilters.push({ col, val });
      return builder;
    };
    builder.order = (col: string, opts: { ascending: boolean }) => {
      state.orderArgs = { col, opts };
      return builder;
    };
    builder.limit = (n: number) => {
      state.limitN = n;
      return builder;
    };
    builder.maybeSingle = async () => handler(state);
    builder.single = async () => handler(state);
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(handler(state)).then(resolve);
    builder.insert = (payload: unknown) => {
      state.insertPayload = payload;
      return builder;
    };
    builder.update = (payload: unknown) => {
      state.updatePayload = payload;
      return builder;
    };
    return builder;
  }
  return {
    from: (table: string) => {
      const state: QueryState = {
        table,
        selectArgs: undefined,
        filters: [],
        isFilters: [],
        orderArgs: undefined,
        limitN: undefined,
        resolveSingle: async () => ({ data: null, error: null }),
        resolveMaybeSingle: async () => ({ data: null, error: null }),
        resolveList: async () => ({ data: [], error: null }),
        insertPayload: undefined,
        updatePayload: undefined,
      };
      return chain(state);
    },
  };
}

const FAKE_USER_ID = "9876fedc-ba98-7654-3210-fedcba987654";

const FAKE_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  owner_id: FAKE_USER_ID,
  name: "My Project",
  state: { version: 1, workflow: { nodes: [], edges: [] } },
  state_version: 1,
  created_at: "2026-05-26T00:00:00Z",
  updated_at: "2026-05-26T00:01:00Z",
  deleted_at: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("SupabaseProjectRepository.getCurrent", () => {
  it("returns the most recent active project for the owner", async () => {
    const client = makeMockClient(() => ({ data: FAKE_ROW, error: null }));
    const repo = new SupabaseProjectRepository(client as never);
    const result = await repo.getCurrent(FAKE_USER_ID);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(FAKE_ROW.id);
    expect(result?.ownerId).toBe(FAKE_USER_ID);
    expect(result?.state).toEqual(FAKE_ROW.state);
  });

  it("returns null when there is no active project", async () => {
    const client = makeMockClient(() => ({ data: null, error: null }));
    const repo = new SupabaseProjectRepository(client as never);
    const result = await repo.getCurrent(FAKE_USER_ID);
    expect(result).toBeNull();
  });

  it("translates RLS denial (42501) into permission_denied", async () => {
    const client = makeMockClient(() => ({
      data: null,
      error: { code: "42501", message: "permission denied" },
    }));
    const repo = new SupabaseProjectRepository(client as never);
    await expect(repo.getCurrent(FAKE_USER_ID)).rejects.toBeInstanceOf(
      ProjectRepositoryError,
    );
    await expect(repo.getCurrent(FAKE_USER_ID)).rejects.toMatchObject({
      code: "permission_denied",
    });
  });
});

describe("SupabaseProjectRepository.save", () => {
  it("inserts a fresh project when no id is provided", async () => {
    let capturedPayload: unknown;
    const client = makeMockClient((state) => {
      if (state.insertPayload !== undefined) capturedPayload = state.insertPayload;
      return { data: FAKE_ROW, error: null };
    });
    const repo = new SupabaseProjectRepository(client as never);
    const result = await repo.save({
      ownerId: FAKE_USER_ID,
      name: "Hello",
      state: { version: 1, workflow: { nodes: [], edges: [] } },
    });
    expect((capturedPayload as { owner_id: string }).owner_id).toBe(FAKE_USER_ID);
    expect((capturedPayload as { name: string }).name).toBe("Hello");
    expect(result.id).toBe(FAKE_ROW.id);
  });

  it("updates an existing project when id is provided", async () => {
    let capturedUpdate: unknown;
    const client = makeMockClient((state) => {
      if (state.updatePayload !== undefined) capturedUpdate = state.updatePayload;
      return { data: { ...FAKE_ROW, name: "Renamed" }, error: null };
    });
    const repo = new SupabaseProjectRepository(client as never);
    const result = await repo.save({
      id: FAKE_ROW.id,
      ownerId: FAKE_USER_ID,
      name: "Renamed",
      state: { version: 1, workflow: { nodes: [], edges: [] } },
    });
    expect(capturedUpdate).toMatchObject({ name: "Renamed" });
    expect(result.name).toBe("Renamed");
  });
});

describe("SupabaseProjectRepository.getOrCreate", () => {
  it("returns existing project when present", async () => {
    let inserted = false;
    const client = makeMockClient((state) => {
      if (state.insertPayload !== undefined) {
        inserted = true;
        return { data: FAKE_ROW, error: null };
      }
      return { data: FAKE_ROW, error: null };
    });
    const repo = new SupabaseProjectRepository(client as never);
    const result = await repo.getOrCreate(FAKE_USER_ID);
    expect(result.id).toBe(FAKE_ROW.id);
    expect(inserted).toBe(false);
  });

  it("creates a new project when none exists", async () => {
    let inserted = false;
    const client = makeMockClient((state) => {
      if (state.insertPayload !== undefined) {
        inserted = true;
        return { data: FAKE_ROW, error: null };
      }
      return { data: null, error: null };
    });
    const repo = new SupabaseProjectRepository(client as never);
    const result = await repo.getOrCreate(FAKE_USER_ID, "New One");
    expect(inserted).toBe(true);
    expect(result.id).toBe(FAKE_ROW.id);
  });
});

describe("SupabaseProjectRepository.rename / softDelete", () => {
  it("rename calls update with the trimmed name", async () => {
    let captured: unknown;
    const client = makeMockClient((state) => {
      if (state.updatePayload !== undefined) captured = state.updatePayload;
      return { data: null, error: null };
    });
    const repo = new SupabaseProjectRepository(client as never);
    await repo.rename(FAKE_ROW.id, "  trimmed  ");
    expect(captured).toEqual({ name: "trimmed" });
  });

  it("rename rejects empty names", async () => {
    const client = makeMockClient(() => ({ data: null, error: null }));
    const repo = new SupabaseProjectRepository(client as never);
    await expect(repo.rename(FAKE_ROW.id, "   ")).rejects.toBeInstanceOf(
      ProjectRepositoryError,
    );
  });

  it("softDelete calls update with deleted_at", async () => {
    let captured: unknown;
    const client = makeMockClient((state) => {
      if (state.updatePayload !== undefined) captured = state.updatePayload;
      return { data: null, error: null };
    });
    const repo = new SupabaseProjectRepository(client as never);
    await repo.softDelete(FAKE_ROW.id);
    expect(captured).toMatchObject({
      deleted_at: expect.any(String),
    });
  });
});
