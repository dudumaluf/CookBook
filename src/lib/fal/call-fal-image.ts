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

export async function callFalImage(
  args: CallFalImageArgs,
): Promise<FalImageSuccessResponse> {
  const { signal, ...body } = args;

  let res: Response;
  try {
    res = await fetch("/api/fal/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
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
