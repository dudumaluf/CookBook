import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _setBYOKRepositoryForTests,
  MissingCredentialsError,
  resolveFalCredentials,
  resolveHiggsfieldCredentials,
  resolveSimpleProviderCredentials,
} from "@/lib/byok/resolver";
import type { BYOKRepository } from "@/lib/byok/repository";
import type { BYOKKeyRecord, BYOKProvider } from "@/lib/byok/types";

/**
 * Slice 7.7 — credential resolver. The contract is:
 *
 *   1. BYOK row present + enabled → return BYOK key, source = "byok".
 *   2. Otherwise → return env, source = "platform".
 *   3. Neither → throw MissingCredentialsError.
 *   4. Decrypt failure → log + fall back to env (don't crash the
 *      whole request because one user's row got stale).
 */

const NEVER_USED: BYOKKeyRecord = {
  provider: "fal",
  fingerprint: "....",
  enabled: true,
  createdAt: "x",
  updatedAt: "x",
};

function makeRepo(impl: Partial<BYOKRepository>): BYOKRepository {
  return {
    list: vi.fn(async () => [NEVER_USED]),
    get: vi.fn(async () => null),
    getDecrypted: vi.fn(async () => null),
    upsert: vi.fn(async () => NEVER_USED),
    setEnabled: vi.fn(async () => NEVER_USED),
    remove: vi.fn(async () => undefined),
    ...impl,
  };
}

const userCtx = {
  userId: "user-1",
  accessToken: "token-1",
};

beforeEach(() => {
  delete process.env.FAL_KEY;
  delete process.env.HIGGSFIELD_API_KEY;
  delete process.env.HIGGSFIELD_API_SECRET;
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  _setBYOKRepositoryForTests(null);
});

describe("resolveFalCredentials", () => {
  it("prefers BYOK over env when present + enabled", async () => {
    _setBYOKRepositoryForTests(
      makeRepo({
        getDecrypted: vi.fn(async (_id: string, p: BYOKProvider) =>
          p === "fal" ? { key: "byok-fal-key" } : null,
        ),
      }),
    );
    process.env.FAL_KEY = "platform-fal-key";
    const r = await resolveFalCredentials(userCtx);
    expect(r.key).toBe("byok-fal-key");
    expect(r.source).toBe("byok");
  });

  it("falls back to env when no BYOK row", async () => {
    _setBYOKRepositoryForTests(
      makeRepo({ getDecrypted: vi.fn(async () => null) }),
    );
    process.env.FAL_KEY = "platform-fal-key";
    const r = await resolveFalCredentials(userCtx);
    expect(r.key).toBe("platform-fal-key");
    expect(r.source).toBe("platform");
  });

  it("falls back to env when user is undefined (no auth context)", async () => {
    process.env.FAL_KEY = "platform-fal-key";
    const r = await resolveFalCredentials(undefined);
    expect(r.source).toBe("platform");
  });

  it("throws MissingCredentialsError when neither source has a key", async () => {
    _setBYOKRepositoryForTests(
      makeRepo({ getDecrypted: vi.fn(async () => null) }),
    );
    await expect(resolveFalCredentials(userCtx)).rejects.toBeInstanceOf(
      MissingCredentialsError,
    );
  });

  it("falls back to env when decryption fails (don't crash the request)", async () => {
    _setBYOKRepositoryForTests(
      makeRepo({
        getDecrypted: vi.fn(async () => {
          throw new Error("AES tag mismatch");
        }),
      }),
    );
    process.env.FAL_KEY = "platform-fal-key";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await resolveFalCredentials(userCtx);
    expect(r.source).toBe("platform");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("resolveHiggsfieldCredentials", () => {
  it("prefers BYOK key+secret pair over env", async () => {
    _setBYOKRepositoryForTests(
      makeRepo({
        getDecrypted: vi.fn(async (_id: string, p: BYOKProvider) =>
          p === "higgsfield"
            ? { key: "byok-key", secret: "byok-secret" }
            : null,
        ),
      }),
    );
    process.env.HIGGSFIELD_API_KEY = "platform-key";
    process.env.HIGGSFIELD_API_SECRET = "platform-secret";
    const r = await resolveHiggsfieldCredentials(userCtx);
    expect(r.key).toBe("byok-key");
    expect(r.secret).toBe("byok-secret");
    expect(r.source).toBe("byok");
  });

  it("falls back to env pair when BYOK is incomplete (no secret)", async () => {
    _setBYOKRepositoryForTests(
      makeRepo({
        getDecrypted: vi.fn(async () =>
          // Imagine corrupted row missing the secret half.
          ({ key: "byok-key", secret: "" }),
        ),
      }),
    );
    process.env.HIGGSFIELD_API_KEY = "platform-key";
    process.env.HIGGSFIELD_API_SECRET = "platform-secret";
    const r = await resolveHiggsfieldCredentials(userCtx);
    expect(r.source).toBe("platform");
  });

  it("throws when nothing is configured", async () => {
    _setBYOKRepositoryForTests(
      makeRepo({ getDecrypted: vi.fn(async () => null) }),
    );
    await expect(resolveHiggsfieldCredentials(userCtx)).rejects.toBeInstanceOf(
      MissingCredentialsError,
    );
  });
});

describe("resolveSimpleProviderCredentials", () => {
  it("returns BYOK when set", async () => {
    _setBYOKRepositoryForTests(
      makeRepo({
        getDecrypted: vi.fn(async (_id: string, p: BYOKProvider) =>
          p === "openai" ? { key: "byok-or" } : null,
        ),
      }),
    );
    const r = await resolveSimpleProviderCredentials(
      userCtx,
      "openai",
      "OPENROUTER_API_KEY",
    );
    expect(r.key).toBe("byok-or");
    expect(r.source).toBe("byok");
  });

  it("falls back to the provided env var when no BYOK row", async () => {
    _setBYOKRepositoryForTests(
      makeRepo({ getDecrypted: vi.fn(async () => null) }),
    );
    process.env.OPENROUTER_API_KEY = "env-or";
    const r = await resolveSimpleProviderCredentials(
      userCtx,
      "openai",
      "OPENROUTER_API_KEY",
    );
    expect(r.key).toBe("env-or");
  });
});
