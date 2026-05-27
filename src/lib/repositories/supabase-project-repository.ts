import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/lib/supabase/client";

import {
  type ProjectRecord,
  type ProjectRepository,
  ProjectRepositoryError,
  PROJECT_STATE_VERSION,
  type ProjectState,
  type SaveProjectInput,
} from "./project-repository";

/**
 * SupabaseProjectRepository — Slice 6.1 (ADR-0034).
 *
 * Concrete repository talking to the `public.projects` table over
 * supabase-js. Trusts RLS to enforce per-user access; we still pass
 * `owner_id` in writes (RLS rejects mismatches with `with check`) so the
 * client never accidentally upserts another user's row even if the JWT
 * was somehow misrouted.
 */

interface RawProjectRow {
  id: string;
  owner_id: string;
  name: string;
  state: ProjectState | null;
  state_version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function rowToRecord(row: RawProjectRow): ProjectRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    state: row.state ?? { version: PROJECT_STATE_VERSION },
    stateVersion: row.state_version,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function mapError(err: unknown, fallbackMessage: string): ProjectRepositoryError {
  // supabase-js uses `code` strings on PostgrestError. The most relevant ones:
  //   PGRST116 — "0 rows" when single() expected exactly one
  //   42501   — RLS deny
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "PGRST116") {
    return new ProjectRepositoryError(e.message ?? fallbackMessage, "not_found");
  }
  if (e?.code === "42501") {
    return new ProjectRepositoryError(
      e.message ?? "Access denied by RLS policy",
      "permission_denied",
    );
  }
  return new ProjectRepositoryError(
    e?.message ?? fallbackMessage,
    "unknown",
  );
}

export class SupabaseProjectRepository implements ProjectRepository {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseClient();
  }

  async getCurrent(userId: string): Promise<ProjectRecord | null> {
    const { data, error } = await this.client
      .from("cookbook_projects")
      .select("*")
      .eq("owner_id", userId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw mapError(error, "Failed to fetch current project");
    if (!data) return null;
    return rowToRecord(data as RawProjectRow);
  }

  async list(userId: string): Promise<ProjectRecord[]> {
    const { data, error } = await this.client
      .from("cookbook_projects")
      .select("*")
      .eq("owner_id", userId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error) throw mapError(error, "Failed to list projects");
    return ((data ?? []) as RawProjectRow[]).map(rowToRecord);
  }

  async save(input: SaveProjectInput): Promise<ProjectRecord> {
    const payload = {
      ...(input.id ? { id: input.id } : {}),
      owner_id: input.ownerId,
      name: input.name,
      state: input.state,
      state_version: input.stateVersion ?? PROJECT_STATE_VERSION,
    };
    if (input.id) {
      // Update — server trigger bumps updated_at automatically.
      const { data, error } = await this.client
        .from("cookbook_projects")
        .update(payload)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw mapError(error, "Failed to save project");
      return rowToRecord(data as RawProjectRow);
    }
    const { data, error } = await this.client
      .from("cookbook_projects")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw mapError(error, "Failed to create project");
    return rowToRecord(data as RawProjectRow);
  }

  async getOrCreate(
    userId: string,
    fallbackName: string = "Untitled Project",
  ): Promise<ProjectRecord> {
    const existing = await this.getCurrent(userId);
    if (existing) return existing;
    return this.save({
      ownerId: userId,
      name: fallbackName,
      state: { version: PROJECT_STATE_VERSION },
    });
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new ProjectRepositoryError("Name cannot be empty", "unknown");
    }
    const { error } = await this.client
      .from("cookbook_projects")
      .update({ name: trimmed })
      .eq("id", id);
    if (error) throw mapError(error, "Failed to rename project");
  }

  async softDelete(id: string): Promise<void> {
    const { error } = await this.client
      .from("cookbook_projects")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw mapError(error, "Failed to delete project");
  }
}

/** Factory — returns the canonical singleton-friendly instance. */
export function getProjectRepository(): ProjectRepository {
  return new SupabaseProjectRepository();
}
