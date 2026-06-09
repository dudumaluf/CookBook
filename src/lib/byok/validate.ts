import "server-only";

import type { BYOKPayload, BYOKProvider } from "./types";

/**
 * Provider key validation — Slice 7.7 / ADR-0073.
 *
 * On `POST /api/byok/keys`, we ping the cheapest "is this key valid"
 * endpoint of each provider before persisting. The goals:
 *
 *   - Catch typos NOW instead of letting the user save a bad key and
 *     wonder why every generation 401s a week later.
 *   - Keep it cheap. We only need to confirm "the key authenticates";
 *     we don't need to actually generate anything.
 *   - Keep it bounded. A 5-second timeout is enough for any health
 *     endpoint; if a provider is slower than that, validation fails
 *     and the user can retry.
 *
 * Returns:
 *   { ok: true } on a successful auth.
 *   { ok: false, reason } on a clean 401/403 (bad key).
 *   { ok: false, reason } on a network/timeout failure (transient —
 *     the caller can decide whether to allow saving anyway, or retry).
 *
 * If a provider doesn't have a cheap-and-cheerful health endpoint
 * (yet), `validateProviderKey` returns `{ ok: true, skipped: true }`
 * — better to allow save than to block on a missing test path.
 */

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  /** True if we don't know how to validate this provider yet. */
  skipped?: boolean;
}

const TIMEOUT_MS = 5_000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error("validation timeout (5s)")),
        TIMEOUT_MS,
      ),
    ),
  ]);
}

async function validateFal(
  payload: BYOKPayload<"fal">,
): Promise<ValidationResult> {
  // Fal doesn't expose a public "ping" endpoint, but every queue
  // status URL with a fake request id returns:
  //   - 401 if the key is invalid
  //   - 404 if the key is valid but the request id doesn't exist
  // Either is a 1-roundtrip auth check.
  try {
    const res = await withTimeout(
      fetch("https://queue.fal.run/fal-ai/health", {
        method: "GET",
        headers: { Authorization: `Key ${payload.key}` },
      }),
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "Fal rejected the key (401/403)." };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `Could not validate Fal key: ${(err as Error).message}`,
    };
  }
}

async function validateHiggsfield(
  payload: BYOKPayload<"higgsfield">,
): Promise<ValidationResult> {
  try {
    const res = await withTimeout(
      fetch(
        "https://platform.higgsfield.ai/v1/custom-references/list?page=1&page_size=1",
        {
          method: "GET",
          headers: {
            Authorization: `Key ${payload.key}:${payload.secret}`,
            Accept: "application/json",
          },
        },
      ),
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "Higgsfield rejected the keys (401/403)." };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: `Higgsfield returned ${res.status}.`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `Could not validate Higgsfield key: ${(err as Error).message}`,
    };
  }
}

export async function validateProviderKey(
  provider: BYOKProvider,
  payload: BYOKPayload,
): Promise<ValidationResult> {
  switch (provider) {
    case "fal":
      return validateFal(payload as BYOKPayload<"fal">);
    case "higgsfield":
      return validateHiggsfield(payload as BYOKPayload<"higgsfield">);
    case "openai":
    case "anthropic":
    case "replicate":
    case "google":
      // These providers have validation endpoints but we don't ship
      // BYOK for them in the v1 UI yet. When they do, add a case here.
      return { ok: true, skipped: true };
    default: {
      // Exhaustiveness check.
      const _: never = provider;
      void _;
      return { ok: true, skipped: true };
    }
  }
}
