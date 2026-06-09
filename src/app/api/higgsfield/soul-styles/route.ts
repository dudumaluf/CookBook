import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/require-user";

import { listSoulStyles } from "@/lib/higgsfield/higgsfield-api";
import type {
  HiggsfieldErrorResponse,
  HiggsfieldSoulStylesResponse,
} from "@/lib/higgsfield/types";

/**
 * GET /api/higgsfield/soul-styles
 *
 * Returns the curated v2 Soul Style presets so the HiggsfieldImageGen
 * settings popover can render a thumbnail picker instead of asking the
 * user to paste a UUID (Slice 5.3 — supersedes the raw-input field
 * shipped in Slice 4.3).
 *
 * Underneath, this hits Higgsfield's `/v1/text2image/soul-styles/v2`
 * endpoint with the LEGACY auth header pair (`hf-api-key` + `hf-secret`)
 * — different from the consolidated `Authorization: Key KEY:SECRET`
 * the generation endpoints use. The wrapper picks the right scheme
 * via `useV1Auth: true`. See ADR-0029.
 *
 * Returns:
 *   200 → `HiggsfieldSoulStylesResponse` (`{ items: [...] }`)
 *   499 → `{ error, code: "aborted" }`
 *   500 → `{ error, code: "missing_keys" | "unknown" }`
 *   502 → `{ error, code: "upstream_error" }`
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const __auth = await requireUser(req);
  if (__auth instanceof NextResponse) return __auth;

  try {
    const items = await listSoulStyles(req.signal, { userId: __auth.userId, accessToken: __auth.accessToken });
    const body: HiggsfieldSoulStylesResponse = { items };
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
  if (e?.code === "upstream_error") {
    return errorResponse(502, "upstream_error", e.message);
  }

  console.error("[api/higgsfield/soul-styles] unexpected failure:", e);
  return errorResponse(500, "unknown", "Failed to list Soul Styles");
}

function errorResponse(
  status: number,
  code: NonNullable<HiggsfieldErrorResponse["code"]>,
  message: string,
): NextResponse<HiggsfieldErrorResponse> {
  return NextResponse.json({ error: message, code }, { status });
}
