import { NextResponse, type NextRequest } from "next/server";

import { getHunyuan3dResult } from "@/lib/fal/hunyuan-3d-api";
import {
  hunyuan3dStatusRequestSchema,
  type FalErrorResponse,
} from "@/lib/fal/types";

/**
 * POST /api/fal/hunyuan-3d/status — poll a queued Hunyuan 3D Pro job.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "Body must be JSON");
  }

  const parsed = hunyuan3dStatusRequestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? issue.path.join(".") : "request";
    const message = issue
      ? `${path}: ${issue.message}`
      : "Invalid request payload";
    return errorResponse(400, "invalid_request", message);
  }

  try {
    const result = await getHunyuan3dResult(
      parsed.data.endpoint,
      parsed.data.requestId,
      req.signal,
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
  console.error("[api/fal/hunyuan-3d/status] unexpected failure:", e);
  return errorResponse(500, "unknown", "Hunyuan 3D status check failed");
}

function errorResponse(
  status: number,
  code: NonNullable<FalErrorResponse["code"]>,
  message: string,
): NextResponse<FalErrorResponse> {
  return NextResponse.json({ error: message, code }, { status });
}
