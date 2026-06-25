import { authedFetch } from "@/lib/auth/authed-fetch";
import { FalCallError } from "./call-seedance";
import type {
  FalErrorResponse,
  TelestyleV2Request,
  TelestyleV2SuccessResponse,
} from "./types";

/**
 * Client wrapper around `POST /api/fal/telestyle-v2`.
 *
 * TeleStyle V2 runs a fast 4-step Lightning edit, so we use a single
 * synchronous request (like SAM 3) with a client-side timeout rather than the
 * submit→poll queue the slower video models use.
 */

export interface CallTelestyleV2Args extends TelestyleV2Request {
  signal: AbortSignal;
}

const TELESTYLE_V2_TIMEOUT_MS = 180_000;

export async function callTelestyleV2(
  args: CallTelestyleV2Args,
): Promise<TelestyleV2SuccessResponse> {
  const { signal, ...body } = args;
  const combined = AbortSignal.any([
    signal,
    AbortSignal.timeout(TELESTYLE_V2_TIMEOUT_MS),
  ]);

  let res: Response;
  try {
    res = await authedFetch("/api/fal/telestyle-v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new FalCallError(
      "Could not reach the TeleStyle V2 endpoint. Is the dev server running?",
      "network",
    );
  }

  if (res.ok) {
    return (await res.json()) as TelestyleV2SuccessResponse;
  }

  let payload: FalErrorResponse | null = null;
  try {
    payload = (await res.json()) as FalErrorResponse;
  } catch {
    payload = null;
  }
  const message =
    payload?.error ?? `TeleStyle V2 call failed with HTTP ${res.status}`;
  const code = payload?.code ?? "unknown";

  if (res.status === 499) {
    const abortErr = new Error(message);
    abortErr.name = "AbortError";
    throw abortErr;
  }
  throw new FalCallError(message, code);
}
