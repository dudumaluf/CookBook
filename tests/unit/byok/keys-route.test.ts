import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE,
  GET,
  PATCH,
  POST,
} from "@/app/api/byok/keys/route";
import {
  _setRequireUserOverrideForTests,
} from "@/lib/auth/require-user";
import {
  _resetMasterKeyForTests,
  encryptPayload,
} from "@/lib/byok/crypto";
import type { BYOKKeyRecord, BYOKProvider } from "@/lib/byok/types";

/**
 * Slice 7.7 — `/api/byok/keys` CRUD smoke tests. Run end-to-end against
 * a mocked Supabase client + the real validate fetch (mocked global
 * fetch), so the route's wiring is exercised but no network IO leaves
 * the test process.
 *
 * The MASTER_KEY is set once for the whole file because the route's
 * upsert path calls `encryptPayload`. Using a fixed test key keeps
 * the suite deterministic.
 */

const MASTER_KEY = "a".repeat(64);

interface RawRow {
  owner_id: string;
  provider: BYOKProvider;
  encrypted_payload: string;
  key_fingerprint: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

let rows: RawRow[] = [];

vi.mock("@supabase/supabase-js", () => {
  function makeChain(opts: { single?: boolean } = {}) {
    const filters: Record<string, string> = {};
    let pendingUpdate: Partial<RawRow> | null = null;
    let pendingUpsert: RawRow | null = null;
    let isDelete = false;
    const chain: {
      eq(col: string, val: string): typeof chain;
      order(): typeof chain;
      maybeSingle(): unknown;
      single(): unknown;
      select(): typeof chain;
      then(onFulfilled: (v: unknown) => unknown): unknown;
      _exec(): { data: RawRow | RawRow[] | null; error: null };
    } = {
      eq(col, val) {
        filters[col] = val;
        return chain;
      },
      order() {
        return chain;
      },
      maybeSingle() {
        const data = chain._exec().data;
        return Promise.resolve({
          data: Array.isArray(data) ? (data[0] ?? null) : data,
          error: null,
        });
      },
      single() {
        const data = chain._exec().data;
        return Promise.resolve({
          data: Array.isArray(data) ? (data[0] ?? null) : data,
          error: null,
        });
      },
      select() {
        return chain;
      },
      then(onFulfilled) {
        return Promise.resolve(chain._exec()).then(onFulfilled);
      },
      _exec() {
        if (pendingUpsert) {
          const idx = rows.findIndex(
            (r) =>
              r.owner_id === pendingUpsert!.owner_id &&
              r.provider === pendingUpsert!.provider,
          );
          if (idx === -1) rows.push(pendingUpsert);
          else rows[idx] = pendingUpsert;
          return { data: pendingUpsert, error: null };
        }
        if (pendingUpdate) {
          const matched = rows.filter((r) =>
            Object.entries(filters).every(
              ([k, v]) => (r as unknown as Record<string, string>)[k] === v,
            ),
          );
          for (const m of matched) Object.assign(m, pendingUpdate);
          return { data: matched[0] ?? null, error: null };
        }
        if (isDelete) {
          rows = rows.filter(
            (r) =>
              !Object.entries(filters).every(
                ([k, v]) => (r as unknown as Record<string, string>)[k] === v,
              ),
          );
          return { data: null, error: null };
        }
        const matched = rows.filter((r) =>
          Object.entries(filters).every(
            ([k, v]) => (r as unknown as Record<string, string>)[k] === v,
          ),
        );
        if (opts.single) return { data: matched[0] ?? null, error: null };
        return { data: matched, error: null };
      },
    };
    return {
      chain,
      setUpsert(row: RawRow) {
        pendingUpsert = row;
      },
      setUpdate(patch: Partial<RawRow>) {
        pendingUpdate = patch;
      },
      setDelete() {
        isDelete = true;
      },
    };
  }

  return {
    createClient() {
      return {
        from() {
          return {
            select() {
              return makeChain().chain;
            },
            upsert(row: RawRow) {
              const c = makeChain();
              c.setUpsert(row);
              return c.chain;
            },
            update(patch: Partial<RawRow>) {
              const c = makeChain();
              c.setUpdate(patch);
              return c.chain;
            },
            delete() {
              const c = makeChain();
              c.setDelete();
              return c.chain;
            },
          };
        },
      };
    },
  };
});

const fetchMock = vi.fn();

beforeEach(() => {
  rows = [];
  process.env.BYOK_MASTER_KEY = MASTER_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "pk";
  _resetMasterKeyForTests();
  _setRequireUserOverrideForTests({
    userId: "user-1",
    accessToken: "token-1",
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  _setRequireUserOverrideForTests(null);
});

function makeRequest(
  url: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Request {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(url, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

describe("GET /api/byok/keys", () => {
  it("returns the empty list when the user has no rows", async () => {
    const res = await GET(makeRequest("http://localhost/api/byok/keys") as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: BYOKKeyRecord[] };
    expect(body.keys).toEqual([]);
  });

  it("returns saved rows in public-shape (no ciphertext)", async () => {
    rows = [
      {
        owner_id: "user-1",
        provider: "fal",
        encrypted_payload: encryptPayload(JSON.stringify({ key: "k123" })),
        key_fingerprint: "k123",
        enabled: true,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ];
    const res = await GET(makeRequest("http://localhost/api/byok/keys") as never);
    const body = (await res.json()) as { keys: BYOKKeyRecord[] };
    expect(body.keys).toEqual([
      expect.objectContaining({
        provider: "fal",
        fingerprint: "k123",
        enabled: true,
      }),
    ]);
    // Critical: the ciphertext is NEVER in the response.
    expect(JSON.stringify(body)).not.toContain("encrypted_payload");
  });
});

describe("POST /api/byok/keys", () => {
  it("rejects an unknown provider", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/byok/keys", {
        method: "POST",
        body: { provider: "midjourney", payload: { key: "x" } },
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a bad payload shape", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/byok/keys", {
        method: "POST",
        body: { provider: "fal", payload: {} },
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("rejects when validation fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    const res = await POST(
      makeRequest("http://localhost/api/byok/keys", {
        method: "POST",
        body: { provider: "fal", payload: { key: "fakekey1234" } },
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_key");
    expect(rows).toHaveLength(0);
  });

  it("persists when validation passes and never echoes the key back", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    const res = await POST(
      makeRequest("http://localhost/api/byok/keys", {
        method: "POST",
        body: { provider: "fal", payload: { key: "real-key-abcd" } },
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      record: BYOKKeyRecord;
      validated: boolean;
      fingerprint: string;
    };
    expect(body.record.provider).toBe("fal");
    expect(body.fingerprint).toBe("abcd");
    expect(JSON.stringify(body)).not.toContain("real-key-abcd");
    expect(rows).toHaveLength(1);
  });
});

describe("PATCH /api/byok/keys", () => {
  it("toggles the enabled flag", async () => {
    rows = [
      {
        owner_id: "user-1",
        provider: "fal",
        encrypted_payload: encryptPayload(JSON.stringify({ key: "k" })),
        key_fingerprint: "abcd",
        enabled: true,
        created_at: "x",
        updated_at: "x",
      },
    ];
    const res = await PATCH(
      makeRequest("http://localhost/api/byok/keys?provider=fal", {
        method: "PATCH",
        body: { enabled: false },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(rows[0]!.enabled).toBe(false);
  });
});

describe("DELETE /api/byok/keys", () => {
  it("removes the row", async () => {
    rows = [
      {
        owner_id: "user-1",
        provider: "fal",
        encrypted_payload: encryptPayload(JSON.stringify({ key: "k" })),
        key_fingerprint: "abcd",
        enabled: true,
        created_at: "x",
        updated_at: "x",
      },
    ];
    const res = await DELETE(
      makeRequest("http://localhost/api/byok/keys?provider=fal", {
        method: "DELETE",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(0);
  });

  it("rejects an unknown provider", async () => {
    const res = await DELETE(
      makeRequest("http://localhost/api/byok/keys?provider=fake", {
        method: "DELETE",
      }) as never,
    );
    expect(res.status).toBe(400);
  });
});
