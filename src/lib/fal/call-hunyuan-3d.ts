import { FalCallError } from "./call-seedance";
import type {
  FalErrorResponse,
  Hunyuan3dRequest,
  Hunyuan3dStatusResponse,
  Hunyuan3dSubmitResponse,
  Hunyuan3dSuccessResponse,
} from "./types";

/**
 * Client wrapper for the async Hunyuan 3D Pro queue.
 *
 * Same submit-then-poll resilience pattern as Seedance (ADR-0057): a fast
 * submit that returns a request id, then small status pings every few
 * seconds. Tolerant of a handful of transient network errors so a brief
 * blip during a multi-minute mesh render doesn't lose the job.
 */

export interface CallHunyuan3dArgs extends Hunyuan3dRequest {
  signal: AbortSignal;
}

const POLL_INTERVAL_MS = 4_000;
const MAX_POLL_MS = 900_000;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

export async function callHunyuan3d(
  args: CallHunyuan3dArgs,
): Promise<Hunyuan3dSuccessResponse> {
  const { signal, ...body } = args;

  let submitRes: Response;
  try {
    submitRes = await fetch("/api/fal/hunyuan-3d", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new FalCallError(
      "Could not reach the Hunyuan 3D endpoint. Is the dev server running?",
      "network",
    );
  }

  if (!submitRes.ok) {
    throw await parseFalError(submitRes);
  }

  const { requestId, endpoint } =
    (await submitRes.json()) as Hunyuan3dSubmitResponse;

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
      statusRes = await fetch("/api/fal/hunyuan-3d/status", {
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
          "Lost connection while waiting for the 3D model. Try Run again.",
          "network",
        );
      }
      continue;
    }

    consecutiveErrors = 0;

    if (!statusRes.ok) {
      throw await parseFalError(statusRes);
    }

    const status = (await statusRes.json()) as Hunyuan3dStatusResponse;
    if (status.status === "pending") continue;

    const { status: _s, ...result } = status;
    return result;
  }

  throw new FalCallError(
    "Hunyuan 3D timed out. The job may still finish on Fal — try Run again in a moment.",
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
    payload?.error ?? `Hunyuan 3D call failed with HTTP ${res.status}`;
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
