import type {
  LlmErrorResponse,
  LlmRequest,
  LlmSuccessResponse,
} from "./types";

/**
 * Client-side wrapper around `POST /api/fal/openrouter`.
 *
 * The route + this wrapper are intentionally a thin pair: the route
 * holds the secret and validates input; this wrapper handles fetch
 * mechanics + error normalisation so callers (`LLMText.execute()`,
 * future `LLM Vision` nodes) only deal with `{ text, costUsd? }` or
 * a `LlmCallError`.
 *
 * Cancellation: pass the runner's `AbortSignal`. Fetch will throw a
 * DOMException with `.name === "AbortError"` which we re-throw with
 * the same name preserved so the execution engine can treat it as
 * cancellation rather than a "real" error.
 */

export interface CallOpenRouterArgs extends LlmRequest {
  signal: AbortSignal;
}

export class LlmCallError extends Error {
  readonly code: NonNullable<LlmErrorResponse["code"]> | "network";
  constructor(
    message: string,
    code: NonNullable<LlmErrorResponse["code"]> | "network",
  ) {
    super(message);
    this.name = "LlmCallError";
    this.code = code;
  }
}

export async function callOpenRouter(
  args: CallOpenRouterArgs,
): Promise<LlmSuccessResponse> {
  const { signal, ...body } = args;

  let res: Response;
  try {
    res = await fetch("/api/fal/openrouter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // Preserve AbortError so the engine's `name === "AbortError"` check
    // routes the run into the "cancelled" branch instead of "error".
    if ((err as Error)?.name === "AbortError") {
      throw err;
    }
    throw new LlmCallError(
      "Could not reach the LLM endpoint. Is the dev server running?",
      "network",
    );
  }

  if (res.ok) {
    const data = (await res.json()) as LlmSuccessResponse;
    return data;
  }

  // Try to parse the structured error; fall back to a generic message
  // if the body isn't JSON (e.g. nginx-style 502 from a misconfigured
  // reverse proxy in some deploy environments).
  let payload: LlmErrorResponse | null = null;
  try {
    payload = (await res.json()) as LlmErrorResponse;
  } catch {
    payload = null;
  }

  const message =
    payload?.error ?? `LLM call failed with HTTP ${res.status}`;
  const code = payload?.code ?? "unknown";

  // 499 from our route means the request was cancelled (server saw the
  // client disconnect). Surface as AbortError so the engine handles it
  // the same as a local cancellation.
  if (res.status === 499) {
    const abortErr = new Error(message);
    abortErr.name = "AbortError";
    throw abortErr;
  }

  throw new LlmCallError(message, code);
}
