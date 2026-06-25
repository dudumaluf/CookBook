import { authedFetch } from "@/lib/auth/authed-fetch";
import { FalCallError } from "./call-seedance";
import type {
  FalErrorResponse,
  FalImageRequest,
  FalImageSuccessResponse,
} from "./types";

/**
 * Client wrapper around `POST /api/fal/image` — Slice F. Reuses FalCallError
 * (499 -> AbortError) from the Seedance client wrapper.
 */

export interface CallFalImageArgs extends FalImageRequest {
  signal: AbortSignal;
}

/**
 * Hard ceiling so a hung request can't pin the engine's isRunning forever.
 * Matches the server route's `maxDuration` (300s) — GPT Image 2 at high
 * quality (or many/large images) is the slow path; every other model returns
 * well under this, so the ceiling only ever bites a genuinely stuck request.
 */
const IMAGE_TIMEOUT_MS = 300_000;

export async function callFalImage(
  args: CallFalImageArgs,
): Promise<FalImageSuccessResponse> {
  const { signal, ...body } = args;
  // Combine the engine's abort signal with a timeout. On user-cancel the
  // engine signal fires (AbortError -> cancelled); on timeout a TimeoutError
  // fires (-> surfaced as an error). Either way the run completes and the
  // node's Run button un-greys.
  const combined = AbortSignal.any([signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)]);

  let res: Response;
  try {
    res = await authedFetch("/api/fal/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (err) {
    const name = (err as Error)?.name;
    // User cancel — let the engine see a real AbortError.
    if (name === "AbortError") throw err;
    // The combined signal's timeout fired (vs. a genuine network failure).
    // Report it honestly: the model may well have finished on Fal's side.
    if (name === "TimeoutError") {
      throw new FalCallError(
        `Fal image request timed out after ${Math.round(
          IMAGE_TIMEOUT_MS / 1000,
        )}s. Slow models (GPT Image 2 at high quality, or many/large images) can exceed this — the image may still finish on Fal. Try again, or lower the quality / image count.`,
        "timeout",
      );
    }
    throw new FalCallError(
      "Could not reach the Fal image endpoint. Is the dev server running?",
      "network",
    );
  }

  if (res.ok) {
    return (await res.json()) as FalImageSuccessResponse;
  }

  let payload: FalErrorResponse | null = null;
  try {
    payload = (await res.json()) as FalErrorResponse;
  } catch {
    payload = null;
  }
  const message =
    payload?.error ?? `Fal image call failed with HTTP ${res.status}`;
  const code = payload?.code ?? "unknown";

  if (res.status === 499) {
    const abortErr = new Error(message);
    abortErr.name = "AbortError";
    throw abortErr;
  }
  throw new FalCallError(message, code);
}
