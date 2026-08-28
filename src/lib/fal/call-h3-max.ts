import { authedFetch } from "@/lib/auth/authed-fetch";
import { FalCallError } from "./call-seedance";
import type {
  FalErrorResponse,
  H3MaxRequest,
  H3MaxStatusResponse,
  H3MaxSubmitResponse,
  H3MaxSuccessResponse,
} from "./types";

/**
 * Client wrapper for the async MiniMax H3 Max image-to-video queue.
 */

export type CallH3MaxArgs = H3MaxRequest & { signal: AbortSignal };

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 1_200_000;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

export async function callH3Max(
  args: CallH3MaxArgs,
): Promise<H3MaxSuccessResponse> {
  const { signal, ...body } = args;

  let submitRes: Response;
  try {
    submitRes = await authedFetch("/api/fal/h3-max", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new FalCallError(
      "Could not reach the H3 Max endpoint. Is the dev server running?",
      "network",
    );
  }

  if (!submitRes.ok) {
    throw await parseFalError(submitRes);
  }

  const { requestId, endpoint } =
    (await submitRes.json()) as H3MaxSubmitResponse;

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
      statusRes = await authedFetch("/api/fal/h3-max/status", {
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
          "Lost connection while waiting for H3 Max. It may still finish on Fal — check the Gallery shortly.",
          "network",
        );
      }
      continue;
    }

    consecutiveErrors = 0;

    if (!statusRes.ok) {
      throw await parseFalError(statusRes);
    }

    const status = (await statusRes.json()) as H3MaxStatusResponse;
    if (status.status === "pending") continue;

    return {
      videoUrl: status.videoUrl,
      mime: status.mime,
      model: status.model,
    };
  }

  throw new FalCallError(
    "H3 Max timed out. The job may still finish on Fal — try Run again in a moment.",
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
    payload?.error ?? `H3 Max call failed with HTTP ${res.status}`;
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
