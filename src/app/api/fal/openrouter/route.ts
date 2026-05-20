import { NextResponse, type NextRequest } from "next/server";

import { callFalOpenRouter } from "@/lib/llm/fal-openrouter";
import { llmRequestSchema, type LlmErrorResponse } from "@/lib/llm/types";

/**
 * POST /api/fal/openrouter
 *
 * Proxies a single LLM completion through Fal's `openrouter/router`
 * (or `openrouter/router/vision` when images are wired). This route
 * exists exclusively to keep `FAL_KEY` out of the browser bundle —
 * the client wrapper `callOpenRouter()` is the only intended caller.
 *
 * Returns:
 *   200 → `LlmSuccessResponse` (`{ text, model, costUsd?, ... }`)
 *   400 → `LlmErrorResponse` (`{ error, code: "invalid_request" }`) — zod failure
 *   499 → `LlmErrorResponse` (`{ error, code: "aborted" }`) — request was cancelled
 *   500 → `LlmErrorResponse` (`{ error, code: "upstream_error" | "missing_key" | "unknown" }`)
 *
 * `dynamic = "force-dynamic"` because the route MUST execute on every
 * call (no caching of LLM responses; that's the engine's job, keyed by
 * the deterministic node hash).
 */
export const dynamic = "force-dynamic";
// Node runtime: the Fal client needs the full Node.js fetch + stream stack.
// Edge would be marginally faster cold-start but the SDK isn't edge-safe.
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
    // Prefix the field path so the message tells the caller *which*
    // field failed — Zod's default ("expected string, received undefined")
    // is useless on its own.
    const path = issue?.path?.length ? issue.path.join(".") : "request";
    const message = issue
      ? `${path}: ${issue.message}`
      : "Invalid request payload";
    return errorResponse(400, "invalid_request", message);
  }

  try {
    const result = await callFalOpenRouter(parsed.data, req.signal);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

function mapErrorToResponse(err: unknown): NextResponse<LlmErrorResponse> {
  const e = err as Error & { code?: string };

  // Client disconnected (browser navigated away, signal aborted, etc.).
  // 499 is the closest standard-ish code; Next will happily serve it.
  if (e?.name === "AbortError") {
    return errorResponse(499, "aborted", "Request cancelled");
  }

  if (e?.code === "missing_key") {
    return errorResponse(500, "missing_key", e.message);
  }
  if (e?.code === "upstream_error") {
    return errorResponse(502, "upstream_error", e.message);
  }

  // Anything else: log it server-side (will show up in the Next.js
  // terminal) and return a generic message to the client. Don't leak
  // the raw error string — could contain trace details we don't want
  // bleeding into the body the node renders.
  console.error("[api/fal/openrouter] unexpected failure:", e);
  return errorResponse(500, "unknown", "LLM call failed");
}

function errorResponse(
  status: number,
  code: NonNullable<LlmErrorResponse["code"]>,
  message: string,
): NextResponse<LlmErrorResponse> {
  return NextResponse.json({ error: message, code }, { status });
}
