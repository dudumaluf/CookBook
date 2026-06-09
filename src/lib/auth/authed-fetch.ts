/**
 * Browser-side `fetch` wrapper that attaches the current Supabase
 * session as `Authorization: Bearer <jwt>`.
 *
 * Slice 7.7 / ADR-0073 (BYOK + auth gate) — every `/api/*` route
 * verifies the bearer token via `requireUser(req)`. To keep call
 * sites identical to plain `fetch`, this wrapper looks up the
 * session synchronously from the cached Supabase client (no extra
 * round trip), splices the access token into the headers, and
 * delegates to the global `fetch`.
 *
 * Why not just attach the header in every call site individually?
 *
 *   - Centralises one rule: "client → API = always send the JWT".
 *     Easy to grep, easy to flip behaviour later (e.g. cookies).
 *   - Avoids forgetting to add the header on a new call site, which
 *     would surface as a confusing 401 in production.
 *   - Lets us evolve auth (refresh-on-failure, retry, telemetry) in
 *     exactly one file.
 *
 * Failure modes: when there is no session (signed-out browser, SSR,
 * tests without a stub) the wrapper still issues the request without
 * the header. The server will respond 401, which is the correct
 * behaviour — better than silently dropping the call.
 */

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";

let cachedTokenGetter: (() => Promise<string | null>) | null = null;

/**
 * Default token resolver: ask the Supabase singleton for its current
 * session. We call `getSession()` (not `getUser()`) because the JWT
 * is what the server wants and `getSession()` is synchronous-ish
 * (reads localStorage; no network). When the session is missing or
 * expired we return `null`.
 */
async function defaultTokenGetter(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function getTokenGetter(): () => Promise<string | null> {
  return cachedTokenGetter ?? defaultTokenGetter;
}

/**
 * Test-only: override how we fetch the JWT. Component / unit tests
 * can stub this to return a fixed token without spinning up the real
 * Supabase client.
 */
export function _setTokenGetterForTests(
  getter: (() => Promise<string | null>) | null,
): void {
  cachedTokenGetter = getter;
}

function mergeAuthHeader(
  init: RequestInit | undefined,
  token: string,
): RequestInit {
  const next: RequestInit = { ...(init ?? {}) };
  const headers = new Headers(init?.headers);
  // Don't clobber a header the caller explicitly set — they might be
  // passing a service token deliberately.
  if (!headers.has("authorization") && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  next.headers = headers;
  return next;
}

/**
 * Drop-in replacement for `fetch()` that auto-attaches the Supabase
 * session JWT.
 *
 * Every signature accepted by `fetch` works here too — the wrapper
 * only mutates the headers slot.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = await getTokenGetter()();
  if (!token) return fetch(input, init);
  return fetch(input, mergeAuthHeader(init, token));
}
