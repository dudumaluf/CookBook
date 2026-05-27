import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/lib/supabase/client";

import {
  type RecipeFilter,
  type RecipeRecord,
  type RecipeRepository,
  RecipeRepositoryError,
  RECIPE_SUBGRAPH_VERSION,
  type RecipeSubgraph,
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
}

export function getRecipeRepository(): RecipeRepository {
  return new SupabaseRecipeRepository();
}
