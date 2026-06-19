import { authedFetch } from "@/lib/auth/authed-fetch";
import { FalCallError } from "./call-seedance";
import type {
  FalErrorResponse,
  Sam3Request,
  Sam3SuccessResponse,
} from "./types";

/**
 * Client wrapper around `POST /api/fal/sam-3`.
 */

export interface CallSam3Args extends Sam3Request {
  signal: AbortSignal;
}

const SAM3_TIMEOUT_MS = 120_000;

export async function callSam3(args: CallSam3Args): Promise<Sam3SuccessResponse> {
  const { signal, ...body } = args;
  const combined = AbortSignal.any([signal, AbortSignal.timeout(SAM3_TIMEOUT_MS)]);

  let res: Response;
  try {
    res = await authedFetch("/api/fal/sam-3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new FalCallError(
      "Could not reach the SAM 3 endpoint. Is the dev server running?",
      "network",
    );
  }

  if (res.ok) {
    return (await res.json()) as Sam3SuccessResponse;
  }

  let payload: FalErrorResponse | null = null;
  try {
    payload = (await res.json()) as FalErrorResponse;
  } catch {
    payload = null;
  }
  const message = payload?.error ?? `SAM 3 call failed with HTTP ${res.status}`;
  const code = payload?.code ?? "unknown";

  if (res.status === 499) {
    const abortErr = new Error(message);
    abortErr.name = "AbortError";
    throw abortErr;
  }
  throw new FalCallError(message, code);
}
