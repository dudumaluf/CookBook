import { authedFetch } from "@/lib/auth/authed-fetch";
import type {
  LlmErrorResponse,
  LlmRequest,
  LlmSuccessResponse,
} from "./types";

/**
 * Client-side wrapper around `POST /api/llm/chat-completions`.
 *
 * Slice 7.1 (ADR-0041) migrated the underlying endpoint from
 * `/api/fal/openrouter` (Fal's simplified router, no tool calling,
 * no streaming, no multi-turn) to `/api/llm/chat-completions`
 * (OpenAI Chat Completions shape over Fal's openai-compat endpoint).
 * The external API of this function is unchanged — `LLMText.execute()`
 * and the assistant keep calling it with the same args. New callers
 * that want multi-turn or tools pass `messages[]` / `tools[]` directly
 * via the extended `LlmRequest` shape.
 *
 * Cancellation: pass the runner's `AbortSignal`. Fetch will throw a
 * DOMException with `.name === "AbortError"` which we re-throw with
 * the same name preserved so the execution engine can treat it as
 * cancellation rather than a "real" error.
 */

const CHAT_COMPLETIONS_ROUTE = "/api/llm/chat-completions";

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
    res = await authedFetch(CHAT_COMPLETIONS_ROUTE, {
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
