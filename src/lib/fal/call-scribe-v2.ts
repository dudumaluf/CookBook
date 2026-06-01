import { FalCallError } from "./call-seedance";
import type {
  FalErrorResponse,
  ScribeV2Request,
  ScribeV2StatusResponse,
  ScribeV2SubmitResponse,
  ScribeV2SuccessResponse,
} from "./types";

/**
 * Client wrapper for the async ElevenLabs Scribe V2 STT queue.
 *
 * Submit → poll until done. Same resilience pattern as Audio Isolation
 * (ADR-0057): a fast submit returns a request id, then small status pings
 * every few seconds. Tolerates a handful of transient network errors so a
 * brief blip during transcription doesn't lose the job.
 */

export interface CallScribeV2Args extends ScribeV2Request {
  signal: AbortSignal;
}

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_MS = 600_000;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

export async function callScribeV2(
  args: CallScribeV2Args,
): Promise<ScribeV2SuccessResponse> {
  const { signal, ...body } = args;

  let submitRes: Response;
  try {
    submitRes = await fetch("/api/fal/scribe-v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new FalCallError(
      "Could not reach the Scribe V2 endpoint. Is the dev server running?",
      "network",
    );
  }

  if (!submitRes.ok) {
    throw await parseFalError(submitRes);
  }

  const { requestId, endpoint } =
    (await submitRes.json()) as ScribeV2SubmitResponse;

  const deadline = Date.now() + MAX_POLL_MS;
  let consecutiveErrors = 0;

  while (Date.now() < deadline) {
    if (signal.aborted) {
      const abortErr = new Error("Request cancelled");
      abortErr.name = "AbortError";
      throw abortErr;
    }

    await sleep(POLL_INTERVAL_MS, signal);

    let statusRes: Response;
    try {
      statusRes = await fetch("/api/fal/scribe-v2/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, endpoint }),
        signal,
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        throw new FalCallError(
          "Lost connection while waiting for Scribe V2. Try Run again.",
          "network",
        );
      }
      continue;
    }

    consecutiveErrors = 0;

    if (!statusRes.ok) {
      throw await parseFalError(statusRes);
    }

    const status = (await statusRes.json()) as ScribeV2StatusResponse;
    if (status.status === "pending") continue;

    const { status: _s, ...result } = status;
    return result;
  }

  throw new FalCallError(
    "Scribe V2 timed out. The job may still finish on Fal — try Run again in a moment.",
    "timeout",
  );
}

async function parseFalError(res: Response): Promise<FalCallError> {
  let payload: FalErrorResponse | null = null;
  try {
    payload = (await res.json()) as FalErrorResponse;
  } catch {
    payload = null;
  }
  const message =
    payload?.error ?? `Scribe V2 call failed with HTTP ${res.status}`;
  const code = payload?.code ?? "unknown";

  if (res.status === 499) {
    const abortErr = new Error(message);
    abortErr.name = "AbortError";
    throw abortErr;
  }
  return new FalCallError(message, code);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("Request cancelled");
      err.name = "AbortError";
      reject(err);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
