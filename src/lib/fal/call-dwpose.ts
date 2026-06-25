import { authedFetch } from "@/lib/auth/authed-fetch";
import { FalCallError } from "./call-seedance";
import type {
  DwposeRequest,
  DwposeStatusResponse,
  DwposeSubmitResponse,
  DwposeSuccessResponse,
  FalErrorResponse,
} from "./types";

/**
 * Client wrapper for the async DWPose queue.
 *
 * Same submit-then-poll resilience as the other Fal nodes (ADR-0057): a fast
 * submit returns a request id, then small status pings every few seconds.
 * Pose estimation runs the whole clip frame-by-frame, so the deadline is set
 * generously (20 minutes), tolerating 5 consecutive transient errors so a
 * brief network blip doesn't abandon the job.
 */

export interface CallDwposeArgs extends DwposeRequest {
  signal: AbortSignal;
}

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 1_200_000;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

export async function callDwpose(
  args: CallDwposeArgs,
): Promise<DwposeSuccessResponse> {
  const { signal, ...body } = args;

  let submitRes: Response;
  try {
    submitRes = await authedFetch("/api/fal/dwpose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new FalCallError(
      "Could not reach the DWPose endpoint. Is the dev server running?",
      "network",
    );
  }

  if (!submitRes.ok) {
    throw await parseFalError(submitRes);
  }

  const { requestId, endpoint } =
    (await submitRes.json()) as DwposeSubmitResponse;

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
      statusRes = await authedFetch("/api/fal/dwpose/status", {
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
          "Lost connection while waiting for DWPose. Try Run again.",
          "network",
        );
      }
      continue;
    }

    consecutiveErrors = 0;

    if (!statusRes.ok) {
      throw await parseFalError(statusRes);
    }

    const status = (await statusRes.json()) as DwposeStatusResponse;
    if (status.status === "pending") continue;

    const { status: _s, ...result } = status;
    return result;
  }

  throw new FalCallError(
    "DWPose timed out. The job may still finish on Fal — try Run again in a moment.",
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
  const message = payload?.error ?? `DWPose call failed with HTTP ${res.status}`;
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
