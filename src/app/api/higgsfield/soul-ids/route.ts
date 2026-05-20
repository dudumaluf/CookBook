import { NextResponse, type NextRequest } from "next/server";

import { listSoulIds } from "@/lib/higgsfield/higgsfield-api";
import type {
  HiggsfieldErrorResponse,
  HiggsfieldSoulIdListResponse,
} from "@/lib/higgsfield/types";

/**
 * GET /api/higgsfield/soul-ids
 *
 * Returns every Soul ID character trained under the configured API key, so
 * the SoulID library popover (Slice 4.2) can show a clickable list instead
 * of forcing the user to copy-paste UUIDs from cloud.higgsfield.ai.
 *
 * Same secret-boundary discipline as the image route — keeps the API key
 * pair out of the browser bundle.
 *
 * Returns:
 *   200 → `HiggsfieldSoulIdListResponse` (`{ items: [...] }`)
 *   499 → `{ error, code: "aborted" }`
 *   500 → `{ error, code: "missing_keys" | "unknown" }`
 *   502 → `{ error, code: "upstream_error" }`
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const items = await listSoulIds(req.signal);
    const body: HiggsfieldSoulIdListResponse = { items };
    return NextResponse.json(body, { status: 200 });
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
  if (e?.code === "concurrent_limit") {
    return errorResponse(429, "concurrent_limit", e.message);
  }
  if (e?.code === "upstream_error") {
    return errorResponse(502, "upstream_error", e.message);
  }

  console.error("[api/higgsfield/soul-ids] unexpected failure:", e);
  return errorResponse(500, "unknown", "Failed to list Soul IDs");
}

function errorResponse(
  status: number,
  code: NonNullable<HiggsfieldErrorResponse["code"]>,
  message: string,
): NextResponse<HiggsfieldErrorResponse> {
  return NextResponse.json({ error: message, code }, { status });
}
