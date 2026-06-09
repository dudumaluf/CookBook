import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";

import { getSeedanceResult } from "@/lib/fal/seedance-api";
import {
  type FalErrorResponse,
  seedanceStatusRequestSchema,
} from "@/lib/fal/types";

/**
 * POST /api/fal/seedance/status — poll a queued Seedance job (ADR-0057).
 *
 * Body: { endpoint, requestId }. Returns `{ status: "pending" }` while it's
 * still rendering, or `{ status: "done", videoUrl, ... }` once complete. Each
 * call is short, so it survives network blips / tab backgrounding that would
 * kill a single long-held request.
 *
 *   200 -> SeedanceStatusResponse
 *   400 -> { code: "invalid_request" }
 *   499 -> { code: "aborted" }
 *   500 -> { code: "missing_key" | "unknown" }
 *   502 -> { code: "upstream_error" }
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const __auth = await requireUser(req);
  if (__auth instanceof NextResponse) return __auth;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "Body must be JSON");
  }

  const parsed = seedanceStatusRequestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, "invalid_request", "Invalid status payload");
  }

  try {
    const result = await getSeedanceResult(
      parsed.data.endpoint,
      parsed.data.requestId,
      req.signal, { userId: __auth.userId, accessToken: __auth.accessToken });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

function mapErrorToResponse(err: unknown): NextResponse<FalErrorResponse> {
  const e = err as Error & { code?: FalErrorResponse["code"] };
  if (e?.name === "AbortError" || e?.code === "aborted") {
    return errorResponse(499, "aborted", "Request cancelled");
  }
  if (e?.code === "missing_key") {
    return errorResponse(500, "missing_key", e.message);
  }
  if (e?.code === "upstream_error") {
    return errorResponse(502, "upstream_error", e.message);
  }
  console.error("[api/fal/seedance/status] unexpected failure:", e);
  return errorResponse(500, "unknown", "Status check failed");
}

function errorResponse(
  status: number,
  code: NonNullable<FalErrorResponse["code"]>,
  message: string,
): NextResponse<FalErrorResponse> {
  return NextResponse.json({ error: message, code }, { status });
}
