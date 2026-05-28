import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/lib/supabase/client";

import {
  type UserPreferences,
  UserPreferencesError,
  type UserPreferencesRecord,
  type UserPreferencesRepository,
} from "./user-preferences-repository";

interface RawRow {
  owner_id: string;
  preferences: UserPreferences | null;
  updated_at: string;
}

function rowToRecord(row: RawRow): UserPreferencesRecord {
  return {
    ownerId: row.owner_id,
    preferences: row.preferences ?? {},
    updatedAt: row.updated_at,
  };
}

function mapError(err: unknown, fallback: string): UserPreferencesError {
  const e = err as { message?: string; code?: string } | null;
  if (e?.code === "PGRST116") {
    return new UserPreferencesError(e.message ?? fallback, "not_found");
  }
  return new UserPreferencesError(e?.message ?? fallback, "unknown");
}

export class SupabaseUserPreferencesRepository
  implements UserPreferencesRepository
{
  constructor(private client: SupabaseClient = getSupabaseClient()) {}

  async get(ownerId: string): Promise<UserPreferencesRecord | null> {
    const { data, error } = await this.client
      .from("cookbook_user_preferences")
      .select("*")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw mapError(error, "Failed to load user preferences");
    if (!data) return null;
    return rowToRecord(data as RawRow);
  }

  async patch(
    ownerId: string,
    patch: UserPreferences,
  ): Promise<UserPreferencesRecord> {
    const existing = await this.get(ownerId);
    const merged: UserPreferences = { ...(existing?.preferences ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) {
        delete merged[k];
      } else {
        merged[k] = v;
      }
    }
    return this.set(ownerId, merged);
  }

  async set(
    ownerId: string,
    preferences: UserPreferences,
  ): Promise<UserPreferencesRecord> {
    const { data, error } = await this.client
      .from("cookbook_user_preferences")
      .upsert(
        { owner_id: ownerId, preferences },
        { onConflict: "owner_id" },
      )
      .select("*")
      .single();
    if (error) throw mapError(error, "Failed to save user preferences");
    return rowToRecord(data as RawRow);
  }
}

let singleton: UserPreferencesRepository | null = null;
export function getUserPreferencesRepository(): UserPreferencesRepository {
  if (!singleton) singleton = new SupabaseUserPreferencesRepository();
  return singleton;
}

export function setUserPreferencesRepositoryForTests(
  repo: UserPreferencesRepository,
) {
  singleton = repo;
}
