import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/lib/supabase/client";

import {
  type RecipeFilter,
  type RecipeRecord,
  type RecipeRepository,
  RecipeRepositoryError,
  type RecipeVersionRecord,
  RECIPE_SUBGRAPH_VERSION,
  type RecipeSubgraph,
  type SaveAsNewVersionInput,
  type SaveRecipeInput,
} from "./recipe-repository";

interface RawRecipeRow {
  id: string;
  owner_id: string | null;
  name: string;
  description: string | null;
  category: string | null;
  subgraph: RecipeSubgraph | null;
  is_node: boolean;
  parent_recipe_id: string | null;
  created_at: string;
  /** Phase A — present on rows after the recipe-versions migration. */
  version?: number | null;
}

interface RawRecipeVersionRow {
  id: string;
  recipe_id: string;
  version: number;
  subgraph: RecipeSubgraph | null;
  name: string;
  description: string | null;
  category: string | null;
  saved_by: string | null;
  created_at: string;
}

function rowToRecord(row: RawRecipeRow): RecipeRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    category: row.category,
    subgraph: row.subgraph ?? {
      version: RECIPE_SUBGRAPH_VERSION,
      nodes: [],
      edges: [],
    },
    isNode: row.is_node,
    parentRecipeId: row.parent_recipe_id,
    createdAt: row.created_at,
    // Backfill v1 if the column is missing (pre-migration row OR a row
    // returned by Supabase before the column rolled out everywhere).
    version: typeof row.version === "number" && row.version > 0 ? row.version : 1,
  };
}

function versionRowToRecord(row: RawRecipeVersionRow): RecipeVersionRecord {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    version: row.version,
    subgraph: row.subgraph ?? {
      version: RECIPE_SUBGRAPH_VERSION,
      nodes: [],
      edges: [],
    },
    name: row.name,
    description: row.description,
    category: row.category,
    savedBy: row.saved_by,
    createdAt: row.created_at,
  };
}

function mapError(err: unknown, fallback: string): RecipeRepositoryError {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "PGRST116") {
    return new RecipeRepositoryError(e.message ?? fallback, "not_found");
  }
  if (e?.code === "42501") {
    return new RecipeRepositoryError(
      e.message ?? "Access denied by RLS policy",
      "permission_denied",
    );
  }
  return new RecipeRepositoryError(e?.message ?? fallback, "unknown");
}

export class SupabaseRecipeRepository implements RecipeRepository {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseClient();
  }

  async list(filter: RecipeFilter): Promise<RecipeRecord[]> {
    let query = this.client
      .from("cookbook_recipes")
      .select("*")
      .order("created_at", { ascending: false });

    // Three filter shapes:
    //   - own + system: any row matching owner_id = me OR owner_id IS NULL.
    //     (Default for the Library — show user's own next to built-ins.)
    //   - own only: owner_id = me.
    //   - system only: owner_id IS NULL.
    if (filter.ownerId !== undefined && filter.includeSystem) {
      // Postgrest `or` clause: owner_id.eq.<uid>,owner_id.is.null
      query = query.or(`owner_id.eq.${filter.ownerId},owner_id.is.null`);
    } else if (filter.ownerId !== undefined && filter.ownerId !== null) {
      query = query.eq("owner_id", filter.ownerId);
    } else if (filter.ownerId === null) {
      query = query.is("owner_id", null);
    }
    if (filter.category) {
      query = query.eq("category", filter.category);
    }
    query = query.limit(filter.limit ?? 100);

    const { data, error } = await query;
    if (error) throw mapError(error, "Failed to list recipes");
    return ((data ?? []) as RawRecipeRow[]).map(rowToRecord);
  }

  async get(id: string): Promise<RecipeRecord | null> {
    const { data, error } = await this.client
      .from("cookbook_recipes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapError(error, "Failed to fetch recipe");
    if (!data) return null;
    return rowToRecord(data as RawRecipeRow);
  }

  async save(input: SaveRecipeInput): Promise<RecipeRecord> {
    const payload = {
      ...(input.id ? { id: input.id } : {}),
      owner_id: input.ownerId,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      subgraph: input.subgraph,
      is_node: input.isNode ?? false,
      parent_recipe_id: input.parentRecipeId ?? null,
    };
    if (input.id) {
      const { data, error } = await this.client
        .from("cookbook_recipes")
        .update(payload)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw mapError(error, "Failed to update recipe");
      return rowToRecord(data as RawRecipeRow);
    }
    const { data, error } = await this.client
      .from("cookbook_recipes")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw mapError(error, "Failed to insert recipe");
    return rowToRecord(data as RawRecipeRow);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client
      .from("cookbook_recipes")
      .delete()
      .eq("id", id);
    if (error) throw mapError(error, "Failed to delete recipe");
  }

  async saveAsNewVersion(input: SaveAsNewVersionInput): Promise<RecipeRecord> {
    // The RPC archives the prior snapshot + bumps the row in one
    // transaction (see supabase/migrations/20260601_recipe_edit_rpc.sql).
    // RLS on both tables enforces ownership — system recipes (owner_id
    // IS NULL) cannot be edited via this path; they must be forked first.
    const { data, error } = await this.client.rpc(
      "cookbook_save_as_new_version",
      {
        p_recipe_id: input.recipeId,
        p_subgraph: input.subgraph,
        p_name: input.name ?? null,
        p_description: input.description ?? null,
        p_category: input.category ?? null,
      },
    );
    if (error) throw mapError(error, "Failed to save recipe version");
    if (!data) {
      throw new RecipeRepositoryError(
        "saveAsNewVersion returned no row",
        "unknown",
      );
    }
    return rowToRecord(data as RawRecipeRow);
  }

  async listVersions(recipeId: string): Promise<RecipeVersionRecord[]> {
    const { data, error } = await this.client
      .from("cookbook_recipe_versions")
      .select("*")
      .eq("recipe_id", recipeId)
      .order("version", { ascending: false });
    if (error) throw mapError(error, "Failed to list recipe versions");
    return ((data ?? []) as RawRecipeVersionRow[]).map(versionRowToRecord);
  }

  async getVersion(
    recipeId: string,
    version: number,
  ): Promise<RecipeVersionRecord | null> {
    const { data, error } = await this.client
      .from("cookbook_recipe_versions")
      .select("*")
      .eq("recipe_id", recipeId)
      .eq("version", version)
      .maybeSingle();
    if (error) throw mapError(error, "Failed to fetch recipe version");
    if (!data) return null;
    return versionRowToRecord(data as RawRecipeVersionRow);
  }
}

export function getRecipeRepository(): RecipeRepository {
  return new SupabaseRecipeRepository();
}
