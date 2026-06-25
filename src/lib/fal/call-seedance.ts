import { authedFetch } from "@/lib/auth/authed-fetch";
import type {
  FalErrorResponse,
  SeedanceStatusResponse,
  SeedanceSubmitResponse,
  SeedanceVideoRequest,
  SeedanceVideoSuccessResponse,
} from "./types";

/**
 * Client wrapper around the async Seedance queue (ADR-0057).
 *
 * Flow: submit (`POST /api/fal/seedance` → requestId) then poll
 * (`POST /api/fal/seedance/status`) every few seconds until done. Each
 * request is short, so a network blip / tab backgrounding / function timeout
 * no longer kills an in-flight render — the job keeps running on Fal and the
 * next poll picks up the result. A handful of consecutive poll failures are
 * tolerated (the render isn't lost) before giving up.
 *
 * External contract is unchanged: callers still get a
 * `SeedanceVideoSuccessResponse` (or an error / AbortError).
 */

export class FalCallError extends Error {
  readonly code: NonNullable<FalErrorResponse["code"]> | "network";
  constructor(
    message: string,
    code: NonNullable<FalErrorResponse["code"]> | "network",
  ) {
    super(message);
    this.name = "FalCallError";
    this.code = code;
  }
}

export interface CallSeedanceArgs extends SeedanceVideoRequest {
  signal: AbortSignal;
}

/** How often to poll, the overall ceiling, and how many poll blips to ride out. */
const POLL_INTERVAL_MS = 3_000;
// Heavy Seedance jobs (1080p standard + many references, 15s) routinely render
// for many minutes on Fal, and the queue can add more under load. Keep a
// generous ceiling so a legitimately slow render isn't abandoned client-side
// (the job is queued on Fal regardless — this is just how long WE wait). The
// user can always abort early; lower res / the fast tier renders quicker.
const MAX_WAIT_MS = 30 * 60_000;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

function abortError(message = "Request cancelled"): Error {
  const e = new Error(message);
  e.name = "AbortError";
  return e;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(abortError());
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** POST JSON; throws FalCallError("network") on a transport failure, the
 *  server's error on a non-OK response, and AbortError when the signal fires. */
async function postJson<T>(
  url: string,
  body: unknown,
  signal: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await authedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new FalCallError("network error", "network");
  }
  if (res.ok) return (await res.json()) as T;

  let payload: FalErrorResponse | null = null;
  try {
    payload = (await res.json()) as FalErrorResponse;
  } catch {
    payload = null;
  }
  const message = payload?.error ?? `HTTP ${res.status}`;
  const code = payload?.code ?? "unknown";
  if (res.status === 499) throw abortError(message);
  throw new FalCallError(message, code);
}

export async function callSeedanceVideo(
  args: CallSeedanceArgs,
): Promise<SeedanceVideoSuccessResponse> {
  const { signal, ...body } = args;

  // 1. Submit — short request. A failure here means no job was created, so
  // it's safe to surface as a normal error (the user can retry).
  let submit: SeedanceSubmitResponse;
  try {
    submit = await postJson<SeedanceSubmitResponse>(
      "/api/fal/seedance",
      body,
      signal,
    );
  } catch (err) {
    if (err instanceof FalCallError && err.code === "network") {
      throw new FalCallError(
        "Could not reach the Seedance endpoint. Is the dev server running?",
        "network",
      );
    }
    throw err;
  }

  // 2. Poll until done. Ride out transient poll failures — the render is
  // already queued on Fal, so a dropped poll must NOT lose it.
  const deadline = Date.now() + MAX_WAIT_MS;
  let consecutiveErrors = 0;
  for (;;) {
    if (signal.aborted) throw abortError();
    await delay(POLL_INTERVAL_MS, signal);

    let status: SeedanceStatusResponse;
    try {
      status = await postJson<SeedanceStatusResponse>(
        "/api/fal/seedance/status",
        { endpoint: submit.endpoint, requestId: submit.requestId },
        signal,
      );
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      // A real upstream failure (the job errored) — stop. Transient network
      // blips (the symptom we're fixing) are tolerated below.
      if (err instanceof FalCallError && err.code !== "network") throw err;
      if (++consecutiveErrors > MAX_CONSECUTIVE_POLL_ERRORS) {
        throw new FalCallError(
          "Lost connection while waiting for the video. It may still finish on Fal — check the Gallery shortly.",
          "network",
        );
      }
      continue;
    }

    consecutiveErrors = 0;
    if (status.status === "done") {
      return {
        videoUrl: status.videoUrl,
        mime: status.mime,
        seed: status.seed,
        model: status.model,
      };
    }
    if (Date.now() > deadline) {
      throw new FalCallError(
        "Seedance is still rendering after 30 min — heavy jobs (1080p + many references) are slow. It may still finish on Fal; for quicker renders try 720p or the fast / mini tier.",
        "timeout",
      );
    }
  }
}
