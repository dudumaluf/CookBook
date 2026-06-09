import "server-only";

import {
  buildBYOKRepository,
  type BYOKRepository,
} from "./repository";
import type { BYOKPayload, BYOKProvider } from "./types";

/**
 * Server-side credential resolver — Slice 7.7 / ADR-0073.
 *
 * Given a user context (from `requireUser`) and a provider, returns
 * the credentials the upstream call should use:
 *
 *   1. The user has a BYOK row for `provider` AND `enabled = true`
 *      → return their decrypted key.
 *   2. Otherwise → fall back to the platform `process.env.*` value
 *      (same behaviour as before BYOK shipped).
 *
 * Result also includes a `source` discriminator (`"byok" | "platform"`)
 * so call sites can log / surface "this run billed user-key" vs
 * "this run billed platform key" without the resolver leaking the
 * actual credentials in those logs.
 *
 * ## When `userContext` is undefined
 *
 * Background jobs (cron, future webhook receivers) don't have a user
 * — they always use platform creds. Routes that already gate with
 * `requireUser` should always pass a defined user context.
 */

export type UserContext = {
  userId: string;
  accessToken: string;
};

export type CredentialSource = "byok" | "platform";

export interface ResolvedFalCredentials {
  key: string;
  source: CredentialSource;
}

export interface ResolvedHiggsfieldCredentials {
  key: string;
  secret: string;
  source: CredentialSource;
}

export interface ResolvedSimpleCredentials {
  key: string;
  source: CredentialSource;
}

export class MissingCredentialsError extends Error {
  readonly code = "missing_keys";
  readonly provider: BYOKProvider;
  constructor(provider: BYOKProvider, hint: string) {
    super(hint);
    this.name = "MissingCredentialsError";
    this.provider = provider;
  }
}

/**
 * Test seam: lets unit tests inject a fake repo so the resolver can
 * be exercised without spinning up Supabase. Production paths leave
 * this null and rely on `buildBYOKRepository(accessToken)`.
 */
let testRepoOverride: BYOKRepository | null = null;
export function _setBYOKRepositoryForTests(
  repo: BYOKRepository | null,
): void {
  testRepoOverride = repo;
}

async function loadBYOK<P extends BYOKProvider>(
  user: UserContext | undefined,
  provider: P,
): Promise<BYOKPayload<P> | null> {
  if (!user) return null;
  const repo =
    testRepoOverride ?? buildBYOKRepository(user.accessToken);
  try {
    const payload = await repo.getDecrypted(user.userId, provider);
    return payload as BYOKPayload<P> | null;
  } catch (err) {
    // Decryption failures (master-key rotation forgot to re-encrypt)
    // shouldn't crash the whole request — fall through to platform
    // creds. Log loudly; ops will see the row that needs re-saving.
    console.error(
      `[BYOK] Failed to decrypt ${provider} key for user ${user.userId}:`,
      err,
    );
    return null;
  }
}

export async function resolveFalCredentials(
  user: UserContext | undefined,
): Promise<ResolvedFalCredentials> {
  const byok = await loadBYOK(user, "fal");
  if (byok?.key) return { key: byok.key, source: "byok" };
  const env = process.env.FAL_KEY?.trim();
  if (env) return { key: env, source: "platform" };
  throw new MissingCredentialsError(
    "fal",
    "Fal key missing — add your own in Settings → API Keys, or ask the operator to set FAL_KEY.",
  );
}

export async function resolveHiggsfieldCredentials(
  user: UserContext | undefined,
): Promise<ResolvedHiggsfieldCredentials> {
  const byok = await loadBYOK(user, "higgsfield");
  if (byok?.key && byok?.secret) {
    return { key: byok.key, secret: byok.secret, source: "byok" };
  }
  const key = process.env.HIGGSFIELD_API_KEY?.trim();
  const secret = process.env.HIGGSFIELD_API_SECRET?.trim();
  if (key && secret) return { key, secret, source: "platform" };
  throw new MissingCredentialsError(
    "higgsfield",
    "Higgsfield keys missing — add your own in Settings → API Keys, or ask the operator to set HIGGSFIELD_API_KEY + HIGGSFIELD_API_SECRET.",
  );
}

/**
 * Convenience for any "single string key" provider — OpenAI,
 * Anthropic, Replicate, Google. The env var name is passed in so
 * the resolver doesn't have to know each provider's variable.
 */
export async function resolveSimpleProviderCredentials(
  user: UserContext | undefined,
  provider: BYOKProvider,
  envVarName: string,
): Promise<ResolvedSimpleCredentials> {
  const byok = await loadBYOK(user, provider);
  if (byok && "key" in byok && byok.key) {
    return { key: byok.key, source: "byok" };
  }
  const env = process.env[envVarName]?.trim();
  if (env) return { key: env, source: "platform" };
  throw new MissingCredentialsError(
    provider,
    `${envVarName} missing — add your own in Settings → API Keys, or ask the operator to set ${envVarName}.`,
  );
}
