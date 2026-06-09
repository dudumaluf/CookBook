import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Slice 7.7 — `requireUser` is the auth gate every `/api/*` route uses.
 * The contract:
 *
 *   - No `Authorization: Bearer` header → 401.
 *   - Bearer token rejected by Supabase → 401.
 *   - Bearer token accepted → returns `{ userId, accessToken }`.
 *   - Supabase env vars unset → 500 (server misconfigured).
 *
 * The supabase-js `createClient` is mocked via `vi.hoisted` (so the
 * factory exists before the module-under-test imports it) so the
 * gate runs without network IO; that lets us assert each branch
 * deterministically.
 */

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}));

import {
  _setRequireUserOverrideForTests,
  requireUser,
} from "@/lib/auth/require-user";

beforeEach(() => {
  // Disable the global `requireUser` override that `tests/setup.ts`
  // installs — these tests SPECIFICALLY want to exercise the real
  // gate, not the test-bypass.
  _setRequireUserOverrideForTests(null);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "pk";
  getUserMock.mockReset();
});

afterEach(() => {
  _setRequireUserOverrideForTests(null);
});

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/anything", {
    method: "GET",
    headers,
  });
}

describe("requireUser", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const result = await requireUser(makeReq() as never);
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) {
      expect(result.status).toBe(401);
    }
  });

  it("returns 401 when Authorization is malformed", async () => {
    const result = await requireUser(
      makeReq({ Authorization: "NotBearer abc" }) as never,
    );
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) expect(result.status).toBe(401);
  });

  it("returns 401 when supabase rejects the token", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "JWT expired" },
    });
    const result = await requireUser(
      makeReq({ Authorization: "Bearer expired-token" }) as never,
    );
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) expect(result.status).toBe(401);
  });

  it("returns 500 when env vars are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const result = await requireUser(
      makeReq({ Authorization: "Bearer t" }) as never,
    );
    expect(result).toBeInstanceOf(Response);
    if (result instanceof Response) expect(result.status).toBe(500);
  });

  it("returns the user on success", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    const result = await requireUser(
      makeReq({ Authorization: "Bearer good-token" }) as never,
    );
    expect(result).toEqual({
      userId: "user-1",
      accessToken: "good-token",
    });
  });

  it("short-circuits to the test override when set", async () => {
    _setRequireUserOverrideForTests({
      userId: "test-user",
      accessToken: "test-token",
    });
    const result = await requireUser(makeReq() as never);
    expect(result).toEqual({
      userId: "test-user",
      accessToken: "test-token",
    });
    // Verify Supabase was NOT called when the override is active.
    expect(getUserMock).not.toHaveBeenCalled();
  });
});
