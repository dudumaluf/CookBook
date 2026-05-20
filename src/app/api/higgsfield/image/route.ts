import { NextResponse, type NextRequest } from "next/server";

import { generateSoulImage } from "@/lib/higgsfield/higgsfield-api";
import {
  higgsfieldImageRequestSchema,
  type HiggsfieldErrorResponse,
} from "@/lib/higgsfield/types";

/**
 * POST /api/higgsfield/image
 *
 * Proxies a single Higgsfield Soul 2 standard image generation. This route
 * exists exclusively to keep HIGGSFIELD_API_KEY + HIGGSFIELD_API_SECRET out
 * of the browser bundle — the client wrapper `callHiggsfieldImage()` is the
 * only intended caller.
 *
 * Returns:
 *   200 → `HiggsfieldImageSuccessResponse` (`{ imageUrls, requestId, model }`)
 *   400 → `{ error, code: "invalid_request" }` — Zod / superRefine failure
 *   499 → `{ error, code: "aborted" }` — caller cancelled or request timed out client-side
 *   500 → `{ error, code: "missing_keys" | "unknown" }`
 *   502 → `{ error, code: "upstream_error" | "upstream_failed" | "nsfw" | "timeout" }`
 *
 * Mirrors ADR-0024's Fal route shape exactly. ADR-0029 documents the
 * direct-to-Higgsfield decision (Fal does NOT proxy Higgsfield).
 */
export const dynamic = "force-dynamic";
// Node runtime required: poll loop holds the connection open for up to the
// timeout, the SDK uses standard fetch (no edge-incompatible primitives).
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "Body must be JSON");
  }

  const parsed = higgsfieldImageRequestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? issue.path.join(".") : "request";
    const message = issue
      ? `${path}: ${issue.message}`
      : "Invalid request payload";
    return errorResponse(400, "invalid_request", message);
  }

  try {
    const result = await generateSoulImage(parsed.data, req.signal);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

function mapErrorToResponse(
  err: unknown,
): NextResponse<HiggsfieldErrorResponse> {
  const e = err as Error & {
    code?: HiggsfieldErrorResponse["code"];
  };

  if (e?.name === "AbortError") {
    return errorResponse(499, "aborted", "Request cancelled");
  }
  if (e?.code === "missing_keys") {
    return errorResponse(500, "missing_keys", e.message);
  }
  if (e?.code === "nsfw") {
    return errorResponse(502, "nsfw", e.message);
  }
  if (e?.code === "upstream_failed") {
    return errorResponse(502, "upstream_failed", e.message);
  }
  if (e?.code === "upstream_error") {
    return errorResponse(502, "upstream_error", e.message);
  }
  if (e?.code === "timeout") {
    return errorResponse(502, "timeout", e.message);
  }

  console.error("[api/higgsfield/image] unexpected failure:", e);
  return errorResponse(500, "unknown", "Image generation failed");
}

function errorResponse(
  status: number,
  code: NonNullable<HiggsfieldErrorResponse["code"]>,
  message: string,
): NextResponse<HiggsfieldErrorResponse> {
  return NextResponse.json({ error: message, code }, { status });
}
