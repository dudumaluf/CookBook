import type {
  FalErrorResponse,
  SeedanceVideoRequest,
  SeedanceVideoSuccessResponse,
} from "./types";

/**
 * Client wrapper around `POST /api/fal/seedance` — Slice B.
 *
 * Mirrors `callHiggsfieldImage`: typed error class, 499 -> AbortError so the
 * engine routes cancellation correctly.
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

/** Hard ceiling so a hung request can't pin the engine's isRunning forever. */
const VIDEO_TIMEOUT_MS = 5 * 60_000;

export async function callSeedanceVideo(
  args: CallSeedanceArgs,
): Promise<SeedanceVideoSuccessResponse> {
  const { signal, ...body } = args;
  // Engine abort + a timeout ceiling (video is slow — 5 min). Either firing
  // settles the request so the run completes and Run buttons un-grey.
  const combined = AbortSignal.any([
    signal,
    AbortSignal.timeout(VIDEO_TIMEOUT_MS),
  ]);

  let res: Response;
  try {
    res = await fetch("/api/fal/seedance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new FalCallError(
      "Could not reach the Seedance endpoint. Is the dev server running?",
      "network",
    );
  }

  if (res.ok) {
    return (await res.json()) as SeedanceVideoSuccessResponse;
  }

  let payload: FalErrorResponse | null = null;
  try {
    payload = (await res.json()) as FalErrorResponse;
  } catch {
    payload = null;
  }
  const message =
    payload?.error ?? `Seedance call failed with HTTP ${res.status}`;
  const code = payload?.code ?? "unknown";

  if (res.status === 499) {
    const abortErr = new Error(message);
    abortErr.name = "AbortError";
    throw abortErr;
  }
  throw new FalCallError(message, code);
}
