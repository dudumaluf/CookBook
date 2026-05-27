/**
 * Supabase browser client (singleton).
 *
 * Cookbook uses Supabase for cloud-backed asset storage (and, later, db +
 * auth). The browser client is created once per browser session — calling
 * `getSupabaseClient()` from anywhere returns the same instance so we don't
 * spin up multiple connections or duplicate auth listeners.
 *
 * The publishable / anon key is safe to expose in the browser bundle; it
 * only ever grants access permitted by the project's RLS policies.
 * Anything that needs the *service role* key has to run on the server
 * and goes through a different client.
 *
 * Env-var contract (see `.env.example`):
 *   NEXT_PUBLIC_SUPABASE_URL              — project URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  — anon / publishable key
 *   NEXT_PUBLIC_SUPABASE_ASSETS_BUCKET    — bucket name (default: cookbook-assets)
 *
 * **DO NOT** wrap these reads in a helper that takes a dynamic key (e.g.
 * `readEnv("NEXT_PUBLIC_SUPABASE_URL")`). Next.js / Turbopack only
 * statically inline literal `process.env.NEXT_PUBLIC_*` accesses at build
 * time. Dynamic indexed lookups (`process.env[name]`) stay as runtime
 * lookups against a `{}` in the browser bundle, so the values come back
 * `undefined` even when `.env.local` is loaded correctly. Each read here
 * is a literal access for exactly this reason.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

function isNonEmpty(v: string | undefined): v is string {
  return typeof v === "string" && v.length > 0;
}

/** True iff both required env vars are set. Useful for tests + early bail-outs. */
export function isSupabaseConfigured(): boolean {
  return (
    isNonEmpty(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    isNonEmpty(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  );
}

/**
 * Get the singleton browser client. Throws a clear error if env vars are
 * missing — better than letting Supabase fail with a cryptic message at
 * the first call site.
 */
export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!isNonEmpty(url) || !isNonEmpty(key)) {
    throw new Error(
      "Supabase env vars are not set. Copy .env.example to .env.local and fill " +
        "in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, " +
        "then restart `npm run dev` so the new env gets baked into the bundle.",
    );
  }
  cached = createClient(url, key, {
    auth: {
      // Slice 6.1 — Supabase magic-link auth lands. Sessions persist in
      // localStorage (default) so a refresh keeps the user signed in;
      // detectSessionInUrl picks up the magic-link callback hash and
      // hydrates the session automatically; autoRefreshToken renews the
      // JWT in the background so long-lived sessions don't lapse mid-edit.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cached;
}

/** Bucket name from env, falling back to the migration-provisioned default. */
export function getAssetsBucket(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_ASSETS_BUCKET;
  return isNonEmpty(v) ? v : "cookbook-assets";
}

/** Test-only: reset the cached singleton so each test starts clean. */
export function _resetSupabaseClientForTests(): void {
  cached = null;
}
