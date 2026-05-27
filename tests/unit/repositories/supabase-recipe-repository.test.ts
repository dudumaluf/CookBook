import { describe, expect, it } from "vitest";

import { SupabaseRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";

interface QueryState {
  filters: Array<{ col: string; val: unknown }>;
  isFilters: Array<{ col: string; val: unknown }>;
  orFilters: string[];
  insertPayload: unknown;
  updatePayload: unknown;
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
    builder.is = (col: string, val: unknown) => {
      state.isFilters.push({ col, val });
      return builder;
    };
    builder.or = (clause: string) => {
      state.orFilters.push(clause);
      return builder;
    };
    builder.order = () => builder;
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
    builder.delete = () => builder;
    return builder;
  }
  return {
    from: () => {
      const state: QueryState = {
        filters: [],
        isFilters: [],
        orFilters: [],
        insertPayload: undefined,
        updatePayload: undefined,
        limitN: null,
      };
      return chain(state);
    },
  };
}

const FAKE_ROW = {
  id: "r1",
  owner_id: "user-1",
  name: "Soul Image Burst",
  description: "Generate variations",
  category: "image",
  subgraph: { version: 1, nodes: [], edges: [] },
  is_node: false,
  parent_recipe_id: null,
  created_at: "2026-05-26T00:00:00Z",
};

describe("SupabaseRecipeRepository", () => {
  it("list with includeSystem uses or-clause to merge user + system rows", async () => {
    let captured: QueryState | null = null;
    const client = makeMockClient((state) => {
      captured = state;
      return [FAKE_ROW];
    });
    const repo = new SupabaseRecipeRepository(client as never);
    await repo.list({ ownerId: "user-1", includeSystem: true });
    expect(captured).not.toBeNull();
    expect(captured!.orFilters[0]).toBe(
      "owner_id.eq.user-1,owner_id.is.null",
    );
  });

  it("list with ownerId only filters by owner", async () => {
    let captured: QueryState | null = null;
    const client = makeMockClient((state) => {
      captured = state;
      return [FAKE_ROW];
    });
    const repo = new SupabaseRecipeRepository(client as never);
    await repo.list({ ownerId: "user-1" });
    const ownerFilter = captured!.filters.find((f) => f.col === "owner_id");
    expect(ownerFilter?.val).toBe("user-1");
  });

  it("list with ownerId=null filters system-only", async () => {
    let captured: QueryState | null = null;
    const client = makeMockClient((state) => {
      captured = state;
      return [FAKE_ROW];
    });
    const repo = new SupabaseRecipeRepository(client as never);
    await repo.list({ ownerId: null });
    const isFilter = captured!.isFilters.find((f) => f.col === "owner_id");
    expect(isFilter?.val).toBeNull();
  });

  it("save inserts a fresh recipe when no id is provided", async () => {
    let captured: unknown;
    const client = makeMockClient((state) => {
      if (state.insertPayload !== undefined) captured = state.insertPayload;
      return { data: FAKE_ROW, error: null };
    });
    const repo = new SupabaseRecipeRepository(client as never);
    const result = await repo.save({
      ownerId: "user-1",
      name: "Test Recipe",
      subgraph: { version: 1, nodes: [], edges: [] },
    });
    expect((captured as { name: string }).name).toBe("Test Recipe");
    expect(result.id).toBe("r1");
  });

  it("save updates an existing recipe when id is provided", async () => {
    let capturedUpdate: unknown;
    const client = makeMockClient((state) => {
      if (state.updatePayload !== undefined) capturedUpdate = state.updatePayload;
      return { data: { ...FAKE_ROW, name: "Renamed" }, error: null };
    });
    const repo = new SupabaseRecipeRepository(client as never);
    const result = await repo.save({
      id: FAKE_ROW.id,
      ownerId: "user-1",
      name: "Renamed",
      subgraph: { version: 1, nodes: [], edges: [] },
    });
    expect((capturedUpdate as { name: string }).name).toBe("Renamed");
    expect(result.name).toBe("Renamed");
  });
});
