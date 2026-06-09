import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { decryptPayload, encryptPayload, fingerprint } from "./crypto";
import type { BYOKKeyRecord, BYOKPayload, BYOKProvider } from "./types";

/**
 * Server-side BYOK repository — Slice 7.7 / ADR-0073.
 *
 * Wraps `cookbook_provider_keys` with:
 *
 *   - List/get only ever return the public-shape (`BYOKKeyRecord`).
 *   - Plaintext goes through `encryptPayload` before any insert/update.
 *   - `getDecrypted` is the ONLY function that returns plaintext;
 *     it lives here (not in a public route) and is consumed by the
 *     server-side credential resolver.
 *
 * Each call constructs a per-request Supabase client scoped to the
 * caller's JWT so RLS enforces "owner can only touch their own keys"
 * at the DB layer (the repo's own `owner_id` filter is belt-and-
 * suspenders, not the security boundary).
 */

interface RawRow {
  owner_id: string;
  provider: BYOKProvider;
  encrypted_payload: string;
  key_fingerprint: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: RawRow): BYOKKeyRecord {
  return {
    provider: row.provider,
    fingerprint: row.key_fingerprint,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class BYOKRepositoryError extends Error {
  readonly code: "not_found" | "forbidden" | "unknown";
  constructor(
    message: string,
    code: "not_found" | "forbidden" | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "BYOKRepositoryError";
    this.code = code;
  }
}

function mapError(err: unknown, fallback: string): BYOKRepositoryError {
  const e = err as { message?: string; code?: string } | null;
  if (e?.code === "PGRST116") {
    return new BYOKRepositoryError(e.message ?? fallback, "not_found");
  }
  return new BYOKRepositoryError(e?.message ?? fallback, "unknown");
}

/**
 * Build a per-request Supabase client scoped to the caller's JWT.
 * This is what makes RLS enforce ownership; using a shared anon
 * client would let any signed-in user touch any other user's keys.
 */
export function buildUserScopedClient(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) {
    throw new Error("Supabase env vars are not configured on the server.");
  }
  return createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export interface BYOKRepository {
  list(ownerId: string): Promise<BYOKKeyRecord[]>;
  get(
    ownerId: string,
    provider: BYOKProvider,
  ): Promise<BYOKKeyRecord | null>;
  /**
   * Returns the raw decrypted plaintext for a single provider, or
   * null when no row exists / is disabled. Server-only — never expose
   * via an API route.
   */
  getDecrypted(
    ownerId: string,
    provider: BYOKProvider,
    options?: { ignoreEnabled?: boolean },
  ): Promise<BYOKPayload | null>;
  upsert<P extends BYOKProvider>(
    ownerId: string,
    provider: P,
    payload: BYOKPayload<P>,
    fingerprintSource: string,
  ): Promise<BYOKKeyRecord>;
  setEnabled(
    ownerId: string,
    provider: BYOKProvider,
    enabled: boolean,
  ): Promise<BYOKKeyRecord>;
  remove(ownerId: string, provider: BYOKProvider): Promise<void>;
}

export class SupabaseBYOKRepository implements BYOKRepository {
  constructor(private client: SupabaseClient) {}

  async list(ownerId: string): Promise<BYOKKeyRecord[]> {
    const { data, error } = await this.client
      .from("cookbook_provider_keys")
      .select("*")
      .eq("owner_id", ownerId)
      .order("provider", { ascending: true });
    if (error) throw mapError(error, "Failed to list provider keys");
    return (data as RawRow[] | null)?.map(rowToRecord) ?? [];
  }

  async get(
    ownerId: string,
    provider: BYOKProvider,
  ): Promise<BYOKKeyRecord | null> {
    const { data, error } = await this.client
      .from("cookbook_provider_keys")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw mapError(error, "Failed to load provider key");
    if (!data) return null;
    return rowToRecord(data as RawRow);
  }

  async getDecrypted(
    ownerId: string,
    provider: BYOKProvider,
    options: { ignoreEnabled?: boolean } = {},
  ): Promise<BYOKPayload | null> {
    const { data, error } = await this.client
      .from("cookbook_provider_keys")
      .select("encrypted_payload, enabled")
      .eq("owner_id", ownerId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw mapError(error, "Failed to load provider key");
    if (!data) return null;
    const row = data as Pick<RawRow, "encrypted_payload" | "enabled">;
    if (!options.ignoreEnabled && !row.enabled) return null;
    const plaintext = decryptPayload(row.encrypted_payload);
    return JSON.parse(plaintext) as BYOKPayload;
  }

  async upsert<P extends BYOKProvider>(
    ownerId: string,
    provider: P,
    payload: BYOKPayload<P>,
    fingerprintSource: string,
  ): Promise<BYOKKeyRecord> {
    const encrypted = encryptPayload(JSON.stringify(payload));
    const fp = fingerprint(fingerprintSource);
    const { data, error } = await this.client
      .from("cookbook_provider_keys")
      .upsert(
        {
          owner_id: ownerId,
          provider,
          encrypted_payload: encrypted,
          key_fingerprint: fp,
          enabled: true,
        },
        { onConflict: "owner_id,provider" },
      )
      .select("*")
      .single();
    if (error) throw mapError(error, "Failed to save provider key");
    return rowToRecord(data as RawRow);
  }

  async setEnabled(
    ownerId: string,
    provider: BYOKProvider,
    enabled: boolean,
  ): Promise<BYOKKeyRecord> {
    const { data, error } = await this.client
      .from("cookbook_provider_keys")
      .update({ enabled })
      .eq("owner_id", ownerId)
      .eq("provider", provider)
      .select("*")
      .single();
    if (error) throw mapError(error, "Failed to update provider key");
    return rowToRecord(data as RawRow);
  }

  async remove(ownerId: string, provider: BYOKProvider): Promise<void> {
    const { error } = await this.client
      .from("cookbook_provider_keys")
      .delete()
      .eq("owner_id", ownerId)
      .eq("provider", provider);
    if (error) throw mapError(error, "Failed to delete provider key");
  }
}

/**
 * Convenience factory — every API route ends up doing
 * `new SupabaseBYOKRepository(buildUserScopedClient(token))`.
 */
export function buildBYOKRepository(accessToken: string): BYOKRepository {
  return new SupabaseBYOKRepository(buildUserScopedClient(accessToken));
}
