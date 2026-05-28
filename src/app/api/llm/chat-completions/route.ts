import { NextResponse, type NextRequest } from "next/server";

import { callChatCompletions } from "@/lib/llm/chat-completions";
import { llmRequestSchema, type LlmErrorResponse } from "@/lib/llm/types";

/**
 * POST /api/llm/chat-completions — Slice 7.1 (ADR-0041).
 *
 * Replaces /api/fal/openrouter. Speaks the OpenAI Chat Completions
 * shape (multi-turn `messages[]`, `tools[]`, `tool_choice`, `stream`)
 * via the provider abstraction (`src/lib/llm/provider.ts`). Default
 * provider is Fal's `openrouter/router/openai/v1/chat/completions`
 * endpoint — same FAL_KEY, same billing surface as the rest of the
 * app, no additional payment endpoint added.
 *
 * Why a fresh route instead of mutating /api/fal/openrouter?
 *
 *   1. URL signals intent — `chat-completions` reads as "OpenAI shape";
 *      `fal/openrouter` reads as "calling Fal's wrapper". They diverged.
 *   2. The legacy route stays alive for a slice or two so any in-flight
 *      requests during deploy don't 404. It will be deleted in 7.2.
 *
 * Response codes mirror the legacy route:
 *   200 → `LlmSuccessResponse`
 *   400 → `LlmErrorResponse` `code: "invalid_request"` (Zod failure)
 *   499 → `LlmErrorResponse` `code: "aborted"` (client disconnected)
 *   500 → `LlmErrorResponse` `code: "missing_key" | "upstream_error" | "unknown"`
 *
 * `dynamic = "force-dynamic"` because LLM responses MUST run live (no
 * caching at the route layer; the engine handles cache via node hash).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "Body must be JSON");
  }

  const parsed = llmRequestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? issue.path.join(".") : "request";
    const message = issue
      ? `${path}: ${issue.message}`
      : "Invalid request payload";
    return errorResponse(400, "invalid_request", message);
  }

  try {
    const result = await callChatCompletions(parsed.data, req.signal);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

function mapErrorToResponse(err: unknown): NextResponse<LlmErrorResponse> {
  const e = err as Error & { code?: string };

  if (e?.name === "AbortError") {
    return errorResponse(499, "aborted", "Request cancelled");
  }
  if (e?.code === "missing_key") {
    return errorResponse(500, "missing_key", e.message);
  }
  if (e?.code === "upstream_error") {
    return errorResponse(502, "upstream_error", e.message);
  }
  console.error("[api/llm/chat-completions] unexpected failure:", e);
  return errorResponse(500, "unknown", "LLM call failed");
}

function errorResponse(
  status: number,
  code: NonNullable<LlmErrorResponse["code"]>,
  message: string,
): NextResponse<LlmErrorResponse> {
  return NextResponse.json({ error: message, code }, { status });
}
