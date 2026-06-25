import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";

import { getDwposeResult } from "@/lib/fal/dwpose-api";
import {
  dwposeStatusRequestSchema,
  type FalErrorResponse,
} from "@/lib/fal/types";

/** POST /api/fal/dwpose/status — poll a queued DWPose job. */
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

  const parsed = dwposeStatusRequestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? issue.path.join(".") : "request";
    const message = issue
      ? `${path}: ${issue.message}`
      : "Invalid request payload";
    return errorResponse(400, "invalid_request", message);
  }

  try {
    const result = await getDwposeResult(
      parsed.data.endpoint,
      parsed.data.requestId,
      req.signal,
      { userId: __auth.userId, accessToken: __auth.accessToken },
    );
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
  console.error("[api/fal/dwpose/status] unexpected failure:", e);
  return errorResponse(500, "unknown", "DWPose status check failed");
}

function errorResponse(
  status: number,
  code: NonNullable<FalErrorResponse["code"]>,
  message: string,
): NextResponse<FalErrorResponse> {
  return NextResponse.json({ error: message, code }, { status });
}
