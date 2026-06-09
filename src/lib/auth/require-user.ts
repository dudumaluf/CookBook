import "server-only";

import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { _getRequireUserOverride } from "./test-override";

export {
  _setRequireUserOverrideForTests,
} from "./test-override";

/**
 * Server-side auth gate for `/api/*` routes (Slice 7.7 / ADR-0073).
 *
 * Returns `{ userId, supabase }` when the request carries a valid
 * Supabase session, or a `NextResponse` with status 401 / 500 ready
 * to return from the route handler.
 *
 * ## How the JWT travels
 *
 * The browser stores its Supabase session in localStorage
 * (`persistSession: true` in `supabase/client.ts`). On every protected
 * fetch the client wrapper attaches the access token as
 * `Authorization: Bearer <jwt>` (see `src/lib/auth/authed-fetch.ts`).
 * This route helper reads that header, builds a per-request Supabase
 * client scoped to that token, and asks Supabase to verify it
 * (`auth.getUser(token)` checks the JWT signature against the
 * project's signing key + checks expiry).
 *
 * Cookies were not used because:
 *
 *   - The existing client puts sessions in localStorage, not cookies.
 *     Switching to cookies would force a global auth refactor.
 *   - Bearer tokens make this trivially testable (just set a header).
 *   - Stateless — no `@supabase/ssr` dependency, no cookie parsing.
 *
 * ## Usage
 *
 *     export async function POST(req: NextRequest) {
 *       const guard = await requireUser(req);
 *       if (guard instanceof NextResponse) return guard; // 401 / 500
 *       const { userId } = guard;
 *       // ...rest of handler...
 *     }
 *
 * The helper returns a `NextResponse` (not throws) so call sites stay
 * imperative + readable; consumers don't have to wrap the whole
 * handler in try/catch just for the auth shape.
 */

export interface RequireUserResult {
  userId: string;
  /**
   * Pre-built per-request Supabase client scoped to the user's JWT.
   * Use this for any DB read/write where RLS should apply on behalf
   * of the user. Reuses the same project URL + publishable key as the
   * browser client, so RLS policies that key on `auth.uid()` work
   * correctly.
   */
  accessToken: string;
}

/**
 * Test seam — when set (via `_setRequireUserOverrideForTests` in
 * `./test-override.ts`), every call to `requireUser` short-circuits
 * to that user without touching Supabase. The override flag lives in
 * a separate module so `tests/setup.ts` can flip it without
 * transitively pulling in `@supabase/supabase-js` (which would lock
 * the module's `createClient` binding before per-test mocks could
 * apply).
 *
 * Why this exists at all:
 *
 *   - Explicit > implicit. A grep for the setter name finds every
 *     test that depends on the bypass. A magic env-based gate would
 *     hide that.
 *   - Tests that WANT to assert 401 behaviour can call
 *     `_setRequireUserOverrideForTests(null)` for that block.
 */

function isNonEmpty(v: string | undefined): v is string {
  return typeof v === "string" && v.length > 0;
}

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { error: message, code: "unauthorized" },
    { status: 401 },
  );
}

function serverConfigError(message: string): NextResponse {
  return NextResponse.json(
    { error: message, code: "server_misconfigured" },
    { status: 500 },
  );
}

export async function requireUser(
  req: NextRequest,
): Promise<RequireUserResult | NextResponse> {
  const override = _getRequireUserOverride();
  if (override) return override;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!isNonEmpty(url) || !isNonEmpty(anon)) {
    return serverConfigError(
      "Supabase env vars are not configured on the server.",
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return unauthorized("Missing Authorization header. Sign in again.");
  }
  const token = authHeader.slice("bearer ".length).trim();
  if (token.length === 0) {
    return unauthorized("Empty bearer token.");
  }

  // Per-request client. We do NOT cache; each request brings its own
  // user JWT, and reusing a client across requests would leak auth
  // state. The supabase-js constructor is cheap.
  const supabase = createClient(url, anon, {
    auth: {
      // Server-side only — disable everything that touches storage /
      // refresh / URL detection.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return unauthorized(
      error?.message ?? "Invalid or expired session.",
    );
  }
  return { userId: data.user.id, accessToken: token };
}

/**
 * Convenience: returns just the userId or null. Use this when you
 * specifically want to handle the unauth case yourself instead of
 * letting `requireUser` synthesize a 401 response (e.g., a route
 * that has both authenticated and anonymous code paths).
 */
export async function getOptionalUserId(
  req: NextRequest,
): Promise<string | null> {
  const result = await requireUser(req);
  if (result instanceof NextResponse) return null;
  return result.userId;
}
