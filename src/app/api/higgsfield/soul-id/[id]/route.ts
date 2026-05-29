import { NextResponse, type NextRequest } from "next/server";

import { deleteSoulId, getSoulId } from "@/lib/higgsfield/higgsfield-api";
import type { HiggsfieldErrorResponse } from "@/lib/higgsfield/types";

/**
 * GET    /api/higgsfield/soul-id/[id] — poll training status.
 * DELETE /api/higgsfield/soul-id/[id] — remove a trained character.
 *
 * M0b Soul ID training spike. Creds stay server-only.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    const record = await getSoulId(id, req.signal);
    return NextResponse.json({ record }, { status: 200 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    await deleteSoulId(id, req.signal);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

function mapErrorToResponse(
  err: unknown,
): NextResponse<HiggsfieldErrorResponse> {
  const e = err as Error & { code?: HiggsfieldErrorResponse["code"] };
  if (e?.name === "AbortError") {
    return errorResponse(499, "aborted", "Request cancelled");
  }
  if (e?.code === "missing_keys") {
    return errorResponse(500, "missing_keys", e.message);
  }
  if (e?.code === "upstream_error") {
    return errorResponse(502, "upstream_error", e.message);
  }
  console.error("[api/higgsfield/soul-id/[id]] unexpected failure:", e);
  return errorResponse(500, "unknown", "Soul ID request failed");
}

function errorResponse(
  status: number,
  code: NonNullable<HiggsfieldErrorResponse["code"]>,
  message: string,
): NextResponse<HiggsfieldErrorResponse> {
  return NextResponse.json({ error: message, code }, { status });
}
