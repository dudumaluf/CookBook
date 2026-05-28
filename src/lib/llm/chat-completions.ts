import "server-only";

import { getProvider } from "./provider";
import type {
  ChatMessage,
  ChatToolCall,
  LlmRequest,
  LlmSuccessResponse,
} from "./types";

/**
 * SERVER-ONLY. OpenAI Chat Completions wrapper — Slice 7.1 (ADR-0041).
 *
 * Replaces the previous Fal-router wrapper. Speaks the OpenAI Chat
 * Completions shape directly (every modern provider via OpenRouter
 * normalizes to this dialect, so no per-provider translation), which
 * unlocks `messages[]` multi-turn, `tools[]` native function calling,
 * `tool_choice`, and `stream` for later slices — without changing the
 * billing surface (Fal's `openrouter/router/openai/v1/chat/completions`
 * endpoint is the same FAL_KEY we already pay).
 *
 * Two input modes (transparent to callers):
 *
 *   1. **Legacy single-turn**: caller provides `user`, `system?`,
 *      `images?`. We assemble a single user message (multimodal blocks
 *      when images present) + optional system message.
 *   2. **Native multi-turn**: caller provides `messages[]` directly.
 *      Used by the assistant once Slice 7.2 wires multi-turn memory.
 *
 * `tools[]`, `tool_choice`, and `stream` are forwarded verbatim when
 * present — Slice 7.3 wires them into the reasoner. 7.1 ships the
 * passthrough so the route accepts them with no breaking change later.
 *
 * Cancellation: native `signal` support via fetch's AbortSignal.
 * No more racing-against-a-promise pattern (the old Fal SDK didn't
 * accept signals); this is cleaner and lets us actually free upstream
 * compute when the user navigates away.
 */

interface OpenAIChatChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: ChatToolCall[];
  };
  finish_reason?: string | null;
}

interface OpenAIChatResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: OpenAIChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  // Some providers (OpenRouter / Fal) attach cost here directly when the
  // generation is from a metered backend.
  generation?: { id?: string };
}

interface ProviderError {
  error?:
    | string
    | {
        message?: string;
        type?: string;
        code?: string;
      };
}

/**
 * Build the OpenAI-shape request body from our internal LlmRequest.
 * Handles both input modes (legacy + native) and the hybrid case
 * where the caller passes BOTH `system` (string) AND `messages[]` —
 * we prepend the system as a system-role message at index 0, so the
 * caller doesn't need to remember the OpenAI convention every time.
 */
function buildRequestBody(args: LlmRequest): Record<string, unknown> {
  let messages: ChatMessage[];
  if (args.messages) {
    messages = [...args.messages];
    if (
      args.system &&
      args.system.length > 0 &&
      messages[0]?.role !== "system"
    ) {
      messages = [{ role: "system", content: args.system }, ...messages];
    }
  } else {
    messages = buildMessagesFromLegacyShape(args);
  }

  const body: Record<string, unknown> = {
    model: args.model,
    messages,
  };

  if (args.temperature !== undefined) body.temperature = args.temperature;
  if (args.maxTokens !== undefined) body.max_tokens = args.maxTokens;
  // Some providers honor `reasoning` as a top-level boolean, others use
  // `extra_body.reasoning`. Forward both — providers ignore unknown keys.
  if (args.reasoning !== undefined) {
    body.reasoning = args.reasoning;
  }
  if (args.tools && args.tools.length > 0) body.tools = args.tools;
  if (args.toolChoice !== undefined) body.tool_choice = args.toolChoice;
  if (args.parallelToolCalls !== undefined) {
    body.parallel_tool_calls = args.parallelToolCalls;
  }
  if (args.stream === true) body.stream = true;

  return body;
}

function buildMessagesFromLegacyShape(args: LlmRequest): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (args.system && args.system.length > 0) {
    out.push({ role: "system", content: args.system });
  }
  // The schema's `refine` already guarantees `user` is present when
  // `messages` isn't. Belt-and-suspenders for the type checker.
  const userText = args.user ?? "";
  if (args.images && args.images.length > 0) {
    out.push({
      role: "user",
      content: [
        { type: "text", text: userText },
        ...args.images.map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        })),
      ],
    });
  } else {
    out.push({ role: "user", content: userText });
  }
  return out;
}

/**
 * Main entry point. Calls the active provider's chat completions
 * endpoint. Throws on signal abort + on upstream error.
 */
export async function callChatCompletions(
  args: LlmRequest,
  signal: AbortSignal,
): Promise<LlmSuccessResponse> {
  const provider = getProvider();
  if (signal.aborted) throw makeAbort();

  const body = buildRequestBody(args);

  let res: Response;
  try {
    res = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: provider.authHeader(),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    const wrapped = new Error(
      `Network error contacting ${provider.id}: ${(err as Error)?.message ?? "unknown"}`,
    );
    (wrapped as Error & { code?: string }).code = "upstream_error";
    throw wrapped;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let upstreamMessage = `${provider.id} HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as ProviderError;
      const errVal = parsed.error;
      if (typeof errVal === "string") {
        upstreamMessage = `${provider.id}: ${errVal}`;
      } else if (errVal && typeof errVal === "object" && errVal.message) {
        upstreamMessage = `${provider.id}: ${errVal.message}`;
      }
    } catch {
      // body wasn't JSON; keep the default upstreamMessage.
    }
    const wrapped = new Error(upstreamMessage);
    (wrapped as Error & { code?: string }).code = "upstream_error";
    throw wrapped;
  }

  // Non-streaming path. Streaming lands in 7.3 — when `args.stream === true`,
  // we'll return a ReadableStream instead. Today, even if `stream: true`
  // was set, we ignored it during body build (line above) so the JSON
  // path is consistent.
  const data = (await res.json()) as OpenAIChatResponse;
  const choice = data.choices?.[0];
  if (!choice) {
    const wrapped = new Error(`${provider.id} returned no choices`);
    (wrapped as Error & { code?: string }).code = "upstream_error";
    throw wrapped;
  }

  const text = choice.message.content ?? "";
  const toolCalls = choice.message.tool_calls;

  return {
    text,
    model: data.model ?? args.model,
    costUsd: data.usage?.cost,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    ...(choice.finish_reason ? { finishReason: choice.finish_reason } : {}),
  };
}

function makeAbort(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}
