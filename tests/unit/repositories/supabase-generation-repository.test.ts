import { describe, expect, it } from "vitest";

import { SupabaseGenerationRepository } from "@/lib/repositories/supabase-generation-repository";

interface QueryState {
  filters: Array<{ col: string; val: unknown }>;
  insertPayload: unknown;
  updatePayload: unknown;
  ilikeFilters: Array<{ col: string; val: unknown }>;
  rangeArgs: { from: number; to: number } | null;
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
      state.filters.push({ col, val });
      return builder;
    };
    builder.ilike = (col: string, val: unknown) => {
      state.ilikeFilters.push({ col, val });
      return builder;
    };
    builder.order = () => builder;
    builder.limit = (n: number) => {
      state.limitN = n;
      return builder;
    };
    builder.range = (from: number, to: number) => {
      state.rangeArgs = { from, to };
      return builder;
    };
    builder.single = async () => handler(state);
    builder.maybeSingle = async () => handler(state);
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
        insertPayload: undefined,
        updatePayload: undefined,
        ilikeFilters: [],
        rangeArgs: null,
        limitN: null,
      };
      return chain(state);
    },
  };
}

const FAKE_ROW = {
  id: "g1",
  project_id: "p1",
  owner_id: "u1",
  node_id: "n1",
  node_kind: "higgsfield-image-gen",
  run_id: 7,
  output: { type: "image", value: { url: "https://x/test.png" } },
  usage: { costUsd: 0.01 },
  inputs_snapshot: null,
  prompt_text: "a cat",
  pinned: false,
  tags: ["test"],
  content_hash: null,
  created_at: "2026-05-26T12:00:00Z",
};

describe("SupabaseGenerationRepository", () => {
  it("insert maps client row payload to camelCase record", async () => {
    let captured: unknown;
    const client = makeMockClient((state) => {
      if (state.insertPayload !== undefined) captured = state.insertPayload;
      return { data: FAKE_ROW, error: null };
    });
    const repo = new SupabaseGenerationRepository(client as never);
    const result = await repo.insert({
      projectId: "p1",
      ownerId: "u1",
      nodeId: "n1",
      nodeKind: "higgsfield-image-gen",
      runId: 7,
      output: { type: "image", value: { url: "https://x/test.png" } },
      usage: { costUsd: 0.01 },
      promptText: "a cat",
      tags: ["test"],
    });
    expect((captured as { project_id: string }).project_id).toBe("p1");
    expect((captured as { node_kind: string }).node_kind).toBe(
      "higgsfield-image-gen",
    );
    expect(result).not.toBeNull();
    expect(result!.id).toBe("g1");
    expect(result!.promptText).toBe("a cat");
    expect(result!.tags).toEqual(["test"]);
  });

  /* 2026-05-31 — Gallery dedup primitives. */

  it("insert writes content_hash when provided (dedup column)", async () => {
    let captured: unknown;
    const client = makeMockClient((state) => {
      if (state.insertPayload !== undefined) captured = state.insertPayload;
      return { data: { ...FAKE_ROW, content_hash: "abc123" }, error: null };
    });
    const repo = new SupabaseGenerationRepository(client as never);
    const result = await repo.insert({
      projectId: "p1",
      ownerId: "u1",
      nodeId: "n1",
      nodeKind: "higgsfield-image-gen",
      runId: 7,
      output: { type: "image", value: { url: "https://x/test.png" } },
      contentHash: "abc123",
    });
    expect((captured as { content_hash: string }).content_hash).toBe("abc123");
    // Repository surfaces the column on the camelCase record so callers
    // can read it back (used by the gallery list UI when we surface dedup
    // tooling later — for now it's mostly a write-side invariant).
    expect(result?.contentHash).toBe("abc123");
  });

  it("insert returns null when Postgres rejects a unique_violation (23505)", async () => {
    // Partial unique index on `(project_id, node_id, content_hash)` —
    // the DB-level backstop for the dedup. The repo translates the
    // 23505 error code into a soft no-op so the sync layer doesn't
    // surface a toast for "you already have this row".
    const client = makeMockClient(() => ({
      data: null,
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    }));
    const repo = new SupabaseGenerationRepository(client as never);
    const result = await repo.insert({
      projectId: "p1",
      ownerId: "u1",
      nodeId: "n1",
      nodeKind: "higgsfield-image-gen",
      runId: 7,
      output: { type: "image", value: { url: "https://x/test.png" } },
      contentHash: "abc123",
    });
    expect(result).toBeNull();
  });

  it("insert still throws on non-unique-violation errors (network, RLS, etc)", async () => {
    const client = makeMockClient(() => ({
      data: null,
      error: { code: "42501", message: "Access denied by RLS policy" },
    }));
    const repo = new SupabaseGenerationRepository(client as never);
    await expect(
      repo.insert({
        projectId: "p1",
        ownerId: "u1",
        nodeId: "n1",
        nodeKind: "higgsfield-image-gen",
        runId: 7,
        output: { type: "image", value: { url: "https://x/test.png" } },
      }),
    ).rejects.toThrow();
  });

  it("existsByContentHash filters by project + node + hash and returns true when present", async () => {
    let capturedState: QueryState | null = null;
    const client = makeMockClient((state) => {
      capturedState = state;
      return { data: { id: "g1" }, error: null };
    });
    const repo = new SupabaseGenerationRepository(client as never);
    const exists = await repo.existsByContentHash("p1", "n1", "abc123");
    expect(exists).toBe(true);
    expect(capturedState).not.toBeNull();
    const cols = capturedState!.filters.map((f) => f.col);
    expect(cols).toContain("project_id");
    expect(cols).toContain("node_id");
    expect(cols).toContain("content_hash");
  });

  it("existsByContentHash returns false when the row isn't present", async () => {
    const client = makeMockClient(() => ({ data: null, error: null }));
    const repo = new SupabaseGenerationRepository(client as never);
    const exists = await repo.existsByContentHash("p1", "n1", "abc123");
    expect(exists).toBe(false);
  });

  it("existsByContentHash returns false on errors so the caller falls through to insert", async () => {
    // Network / RLS hiccup must NOT silently dedup as if the row exists
    // — that would suppress legitimate writes. Returning false lets the
    // caller proceed to insert, where the DB unique index catches any
    // real duplicate.
    const client = makeMockClient(() => ({
      data: null,
      error: { code: "PGRST301", message: "boom" },
    }));
    const repo = new SupabaseGenerationRepository(client as never);
    const exists = await repo.existsByContentHash("p1", "n1", "abc123");
    expect(exists).toBe(false);
  });

  it("existsByContentHash short-circuits on empty hash", async () => {
    let called = false;
    const client = makeMockClient(() => {
      called = true;
      return { data: null, error: null };
    });
    const repo = new SupabaseGenerationRepository(client as never);
    const exists = await repo.existsByContentHash("p1", "n1", "");
    expect(exists).toBe(false);
    expect(called).toBe(false);
  });

  it("list filters by node + pinned + prompt search", async () => {
    let capturedState: QueryState | null = null;
    const client = makeMockClient((state) => {
      capturedState = state;
      return [FAKE_ROW];
    });
    const repo = new SupabaseGenerationRepository(client as never);
    await repo.list({
      projectId: "p1",
      nodeId: "n1",
      pinnedOnly: true,
      promptContains: "cat",
      limit: 25,
    });
    expect(capturedState).not.toBeNull();
    const cols = capturedState!.filters.map((f) => f.col);
    expect(cols).toContain("project_id");
    expect(cols).toContain("node_id");
    expect(cols).toContain("pinned");
    expect(capturedState!.ilikeFilters[0]).toEqual({
      col: "prompt_text",
      val: "%cat%",
    });
    expect(capturedState!.limitN).toBe(25);
  });

  /* Slice 7.4 — get(id) for the eval tools. */
  it("get returns null when the row isn't present", async () => {
    const client = makeMockClient(() => ({ data: null, error: null }));
    const repo = new SupabaseGenerationRepository(client as never);
    const result = await repo.get("missing");
    expect(result).toBeNull();
  });

  it("get returns the camelCase record when present", async () => {
    const client = makeMockClient(() => ({ data: FAKE_ROW, error: null }));
    const repo = new SupabaseGenerationRepository(client as never);
    const result = await repo.get("g1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("g1");
    expect(result!.promptText).toBe("a cat");
  });

  it("setPinned issues an update with the right column", async () => {
    let captured: unknown;
    const client = makeMockClient((state) => {
      if (state.updatePayload !== undefined) captured = state.updatePayload;
      return { data: null, error: null };
    });
    const repo = new SupabaseGenerationRepository(client as never);
    await repo.setPinned("g1", true);
    expect(captured).toEqual({ pinned: true });
  });

  it("setTags writes the new array", async () => {
    let captured: unknown;
    const client = makeMockClient((state) => {
      if (state.updatePayload !== undefined) captured = state.updatePayload;
      return { data: null, error: null };
    });
    const repo = new SupabaseGenerationRepository(client as never);
    await repo.setTags("g1", ["foo", "bar"]);
    expect(captured).toEqual({ tags: ["foo", "bar"] });
  });

  /* Slice 6.5 — title rename. */
  it("setTitle writes a trimmed title (Slice 6.5)", async () => {
    let captured: unknown;
    const client = makeMockClient((state) => {
      if (state.updatePayload !== undefined) captured = state.updatePayload;
      return { data: null, error: null };
    });
    const repo = new SupabaseGenerationRepository(client as never);
    await repo.setTitle("g1", "  My Cool Generation  ");
    expect(captured).toEqual({ title: "My Cool Generation" });
  });

  it("setTitle stores null when given empty / whitespace (Slice 6.5)", async () => {
    let captured: unknown;
    const client = makeMockClient((state) => {
      if (state.updatePayload !== undefined) captured = state.updatePayload;
      return { data: null, error: null };
    });
    const repo = new SupabaseGenerationRepository(client as never);
    await repo.setTitle("g1", "   ");
    expect(captured).toEqual({ title: null });
  });

  /* Slice 6.5 — outputType filter translates to node_kind IN (...). */
  it("list filter outputType=image queries node_kind in (higgsfield-image-gen)", async () => {
    let capturedIn: { col: string; vals: unknown[] } | null = null;
    const client = {
      from: () => {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.is = () => builder;
        builder.ilike = () => builder;
        builder.order = () => builder;
        builder.limit = () => builder;
        builder.range = () => builder;
        builder.in = (col: string, vals: unknown[]) => {
          capturedIn = { col, vals };
          return builder;
        };
        builder.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve([]).then(resolve);
        return builder;
      },
    };
    const repo = new SupabaseGenerationRepository(client as never);
    await repo.list({ projectId: "p1", outputType: "image" });
    expect(capturedIn).not.toBeNull();
    expect(capturedIn!.col).toBe("node_kind");
    expect(capturedIn!.vals).toContain("higgsfield-image-gen");
    expect(capturedIn!.vals).toContain("fal-image");
  });

  it("list filter outputType=video queries node_kind in (seedance-video) (Slice B)", async () => {
    let capturedIn: { col: string; vals: unknown[] } | null = null;
    const client = {
      from: () => {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.is = () => builder;
        builder.ilike = () => builder;
        builder.order = () => builder;
        builder.limit = () => builder;
        builder.range = () => builder;
        builder.in = (col: string, vals: unknown[]) => {
          capturedIn = { col, vals };
          return builder;
        };
        builder.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve([]).then(resolve);
        return builder;
      },
    };
    const repo = new SupabaseGenerationRepository(client as never);
    await repo.list({ projectId: "p1", outputType: "video" });
    expect(capturedIn).not.toBeNull();
    expect(capturedIn!.col).toBe("node_kind");
    expect(capturedIn!.vals).toContain("seedance-video");
  });
});
