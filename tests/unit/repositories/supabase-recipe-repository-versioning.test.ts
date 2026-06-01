import { describe, expect, it } from "vitest";

import { SupabaseRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";

/**
 * Phase B1 versioning surface — `saveAsNewVersion`, `listVersions`,
 * `getVersion`. Mocks Supabase's chainable query builder + `rpc()`
 * directly; same pattern as `supabase-recipe-repository.test.ts`.
 */

interface VersionsQueryState {
  recipeIdEq: unknown;
  versionEq: unknown;
  orderByCol: string | null;
  orderAsc: boolean | null;
}

const FAKE_ROW = {
  id: "r1",
  owner_id: "user-1",
  name: "Soul Image Burst v2",
  description: "Edited",
  category: "image",
  subgraph: { version: 2, nodes: [], edges: [] },
  is_node: false,
  parent_recipe_id: null,
  created_at: "2026-06-01T00:00:00Z",
  version: 2,
};

const FAKE_VERSION_ROW = {
  id: "v1",
  recipe_id: "r1",
  version: 1,
  subgraph: { version: 1, nodes: [], edges: [] },
  name: "Soul Image Burst",
  description: "Original",
  category: "image",
  saved_by: "user-1",
  created_at: "2026-06-01T00:00:00Z",
};

function makeMockClient(opts: {
  rpcImpl?: (fn: string, args: Record<string, unknown>) => unknown;
  versionsRows?: unknown[];
  versionsRow?: unknown | null;
  captureVersions?: VersionsQueryState;
}) {
  return {
    rpc: (fn: string, args: Record<string, unknown>) =>
      Promise.resolve(
        opts.rpcImpl?.(fn, args) ?? { data: FAKE_ROW, error: null },
      ),
    from: (table: string) => {
      if (table !== "cookbook_recipe_versions") {
        throw new Error(`Unexpected table: ${table}`);
      }
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (col: string, val: unknown) => {
        if (opts.captureVersions) {
          if (col === "recipe_id") opts.captureVersions.recipeIdEq = val;
          if (col === "version") opts.captureVersions.versionEq = val;
        }
        return builder;
      };
      builder.order = (col: string, options?: { ascending?: boolean }) => {
        if (opts.captureVersions) {
          opts.captureVersions.orderByCol = col;
          opts.captureVersions.orderAsc = options?.ascending ?? true;
        }
        return Promise.resolve({ data: opts.versionsRows ?? [], error: null });
      };
      builder.maybeSingle = () =>
        Promise.resolve({
          data: opts.versionsRow ?? null,
          error: null,
        });
      return builder;
    },
  };
}

describe("SupabaseRecipeRepository — Phase B1 versioning", () => {
  describe("saveAsNewVersion", () => {
    it("calls the cookbook_save_as_new_version RPC with named params", async () => {
      let capturedFn = "";
      let capturedArgs: Record<string, unknown> = {};
      const client = makeMockClient({
        rpcImpl: (fn, args) => {
          capturedFn = fn;
          capturedArgs = args;
          return { data: FAKE_ROW, error: null };
        },
      });
      const repo = new SupabaseRecipeRepository(client as never);
      const subgraph = { version: 2, nodes: [], edges: [] };
      const result = await repo.saveAsNewVersion({
        recipeId: "r1",
        subgraph,
        name: "Renamed",
        description: null,
        category: undefined,
      });
      expect(capturedFn).toBe("cookbook_save_as_new_version");
      expect(capturedArgs.p_recipe_id).toBe("r1");
      expect(capturedArgs.p_subgraph).toBe(subgraph);
      expect(capturedArgs.p_name).toBe("Renamed");
      expect(capturedArgs.p_description).toBeNull();
      expect(capturedArgs.p_category).toBeNull();
      expect(result.id).toBe("r1");
      expect(result.version).toBe(2);
    });

    it("propagates RPC errors as RecipeRepositoryError", async () => {
      const client = makeMockClient({
        rpcImpl: () => ({ data: null, error: { code: "42501", message: "denied" } }),
      });
      const repo = new SupabaseRecipeRepository(client as never);
      await expect(
        repo.saveAsNewVersion({
          recipeId: "r1",
          subgraph: { version: 1, nodes: [], edges: [] },
        }),
      ).rejects.toMatchObject({ code: "permission_denied" });
    });

    it("throws when the RPC returns no row (defensive guard)", async () => {
      const client = makeMockClient({
        rpcImpl: () => ({ data: null, error: null }),
      });
      const repo = new SupabaseRecipeRepository(client as never);
      await expect(
        repo.saveAsNewVersion({
          recipeId: "r1",
          subgraph: { version: 1, nodes: [], edges: [] },
        }),
      ).rejects.toMatchObject({ message: /no row/i });
    });
  });

  describe("listVersions", () => {
    it("queries cookbook_recipe_versions filtered by recipe_id, ordered version desc", async () => {
      const captured: VersionsQueryState = {
        recipeIdEq: undefined,
        versionEq: undefined,
        orderByCol: null,
        orderAsc: null,
      };
      const client = makeMockClient({
        captureVersions: captured,
        versionsRows: [FAKE_VERSION_ROW],
      });
      const repo = new SupabaseRecipeRepository(client as never);
      const result = await repo.listVersions("r1");
      expect(captured.recipeIdEq).toBe("r1");
      expect(captured.orderByCol).toBe("version");
      expect(captured.orderAsc).toBe(false);
      expect(result).toHaveLength(1);
      expect(result[0]!.recipeId).toBe("r1");
      expect(result[0]!.version).toBe(1);
      expect(result[0]!.savedBy).toBe("user-1");
    });

    it("returns an empty array when there are no prior versions", async () => {
      const client = makeMockClient({ versionsRows: [] });
      const repo = new SupabaseRecipeRepository(client as never);
      const result = await repo.listVersions("r1");
      expect(result).toEqual([]);
    });
  });

  describe("getVersion", () => {
    it("queries by recipe_id + version and returns the version record", async () => {
      const captured: VersionsQueryState = {
        recipeIdEq: undefined,
        versionEq: undefined,
        orderByCol: null,
        orderAsc: null,
      };
      const client = makeMockClient({
        captureVersions: captured,
        versionsRow: FAKE_VERSION_ROW,
      });
      const repo = new SupabaseRecipeRepository(client as never);
      const result = await repo.getVersion("r1", 1);
      expect(captured.recipeIdEq).toBe("r1");
      expect(captured.versionEq).toBe(1);
      expect(result).not.toBeNull();
      expect(result!.version).toBe(1);
      expect(result!.subgraph.version).toBe(1);
    });

    it("returns null when the (recipeId, version) pair doesn't exist", async () => {
      const client = makeMockClient({ versionsRow: null });
      const repo = new SupabaseRecipeRepository(client as never);
      const result = await repo.getVersion("r1", 99);
      expect(result).toBeNull();
    });
  });
});
