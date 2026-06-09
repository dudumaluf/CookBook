import "server-only";

import { createFalClient, type FalClient } from "@fal-ai/client";

import {
  resolveFalCredentials,
  type UserContext,
} from "@/lib/byok/resolver";

/**
 * Per-request Fal client factory — Slice 7.7 / ADR-0073.
 *
 * Pre-BYOK we used the `fal` global singleton + `fal.config({ credentials })`
 * once. That works for a single platform key, but is unsafe in a
 * multi-tenant BYOK world: under concurrency, user A's `config()` call
 * can clobber user B's credentials between submit and poll, leaking
 * billing across users.
 *
 * Each call here creates a fresh `FalClient` scoped to the resolved
 * credentials (BYOK if the user has one + enabled, platform `FAL_KEY`
 * otherwise). The client is short-lived; the SDK is cheap to construct
 * (a couple of objects, no I/O) so per-request is fine.
 *
 * Returns the source so call sites can log "billed BYOK" vs "billed
 * platform" without leaking the key itself.
 */

export interface BoundFalClient {
  client: FalClient;
  source: "byok" | "platform";
}

export async function buildFalClient(
  user: UserContext | undefined,
): Promise<BoundFalClient> {
  const resolved = await resolveFalCredentials(user);
  return {
    client: createFalClient({ credentials: resolved.key }),
    source: resolved.source,
  };
}
