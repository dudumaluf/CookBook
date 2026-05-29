import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSoulId } from "@/lib/higgsfield/higgsfield-api";
import type { HiggsfieldErrorResponse } from "@/lib/higgsfield/types";

/**
 * POST /api/higgsfield/soul-id/train — M0b Soul ID training spike.
 *
 * Kicks off training a new Soul ID character from public image URLs (our
 * library images are already on Supabase, so we pass URLs directly — no
 * multipart upload). Returns immediately with a not_ready/queued record;
 * the client polls GET /api/higgsfield/soul-id/[id] until completed.
 *
 * Keeps HIGGSFIELD creds server-only.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z
  .object({
    name: z.string().min(1),
    variant: z.enum(["v1", "v2", "cinema"]).default("v2"),
    imageUrls: z.array(z.string().url()).min(1).max(100),
  })
  .strict();

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "Body must be JSON");
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? issue.path.join(".") : "request";
    return errorResponse(
      400,
      "invalid_request",
      issue ? `${path}: ${issue.message}` : "Invalid request payload",
    );
  }

  try {
    const record = await createSoulId(parsed.data, req.signal);
    return NextResponse.json({ record }, { status: 200 });
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
  if (e?.code === "invalid_request") {
    return errorResponse(400, "invalid_request", e.message);
  }
  if (e?.code === "concurrent_limit") {
    return errorResponse(429, "concurrent_limit", e.message);
  }
  if (e?.code === "upstream_error") {
    return errorResponse(502, "upstream_error", e.message);
  }
  console.error("[api/higgsfield/soul-id/train] unexpected failure:", e);
  return errorResponse(500, "unknown", "Soul ID training failed");
}

function errorResponse(
  status: number,
  code: NonNullable<HiggsfieldErrorResponse["code"]>,
  message: string,
): NextResponse<HiggsfieldErrorResponse> {
  return NextResponse.json({ error: message, code }, { status });
}
