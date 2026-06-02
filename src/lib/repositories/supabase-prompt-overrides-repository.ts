import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/lib/supabase/client";

import {
  PromptOverrideError,
  type PromptOverrideRecord,
  type PromptOverridesRepository,
} from "./prompt-overrides-repository";

interface RawRow {
  owner_id: string;
  prompt_key: string;
  body: string;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: RawRow): PromptOverrideRecord {
  return {
    ownerId: row.owner_id,
    promptKey: row.prompt_key,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapError(err: unknown, fallback: string): PromptOverrideError {
  const e = err as { message?: string; code?: string } | null;
  if (e?.code === "PGRST116") {
    return new PromptOverrideError(e.message ?? fallback, "not_found");
  }
  return new PromptOverrideError(e?.message ?? fallback, "unknown");
}

export class SupabasePromptOverridesRepository
  implements PromptOverridesRepository
{
  constructor(private client: SupabaseClient = getSupabaseClient()) {}

  async list(ownerId: string): Promise<PromptOverrideRecord[]> {
    const { data, error } = await this.client
      .from("app_prompt_overrides")
      .select("*")
      .eq("owner_id", ownerId)
      .order("updated_at", { ascending: false });
    if (error) throw mapError(error, "Failed to list prompt overrides");
    return (data ?? []).map((r) => rowToRecord(r as RawRow));
  }

  async get(
    ownerId: string,
    promptKey: string,
  ): Promise<PromptOverrideRecord | null> {
    const { data, error } = await this.client
      .from("app_prompt_overrides")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("prompt_key", promptKey)
      .maybeSingle();
    if (error) throw mapError(error, "Failed to load prompt override");
    if (!data) return null;
    return rowToRecord(data as RawRow);
  }

  async upsert(
    ownerId: string,
    promptKey: string,
    body: string,
  ): Promise<PromptOverrideRecord> {
    const { data, error } = await this.client
      .from("app_prompt_overrides")
      .upsert(
        { owner_id: ownerId, prompt_key: promptKey, body },
        { onConflict: "owner_id,prompt_key" },
      )
      .select("*")
      .single();
    if (error) throw mapError(error, "Failed to save prompt override");
    return rowToRecord(data as RawRow);
  }

  async remove(ownerId: string, promptKey: string): Promise<void> {
    const { error } = await this.client
      .from("app_prompt_overrides")
      .delete()
      .eq("owner_id", ownerId)
      .eq("prompt_key", promptKey);
    if (error) throw mapError(error, "Failed to remove prompt override");
  }
}

let singleton: PromptOverridesRepository | null = null;
export function getPromptOverridesRepository(): PromptOverridesRepository {
  if (!singleton) singleton = new SupabasePromptOverridesRepository();
  return singleton;
}

export function setPromptOverridesRepositoryForTests(
  repo: PromptOverridesRepository,
): void {
  singleton = repo;
}
