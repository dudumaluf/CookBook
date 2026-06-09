import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/require-user";
import { fingerprint } from "@/lib/byok/crypto";
import { buildBYOKRepository } from "@/lib/byok/repository";
import {
  BYOK_PROVIDERS,
  isBYOKProvider,
  type BYOKProvider,
} from "@/lib/byok/types";
import { validateProviderKey } from "@/lib/byok/validate";

/**
 * `/api/byok/keys` — Slice 7.7 / ADR-0073.
 *
 * BYOK CRUD for the signed-in user. All endpoints are gated by
 * `requireUser`; the user can only ever see/touch their OWN rows
 * (RLS enforces this at the DB layer too).
 *
 *   GET    /api/byok/keys                 — list all of my BYOK keys
 *                                            (public-shape: provider,
 *                                            fingerprint, enabled,
 *                                            timestamps; never the
 *                                            ciphertext).
 *   POST   /api/byok/keys                 — create/replace a key for
 *                                            a single provider. Body:
 *                                            { provider, payload }.
 *                                            Validates the key live
 *                                            against the provider
 *                                            before persisting.
 *   PATCH  /api/byok/keys?provider=fal    — toggle enabled. Body:
 *                                            { enabled: boolean }.
 *   DELETE /api/byok/keys?provider=fal    — remove the row.
 *
 * Why one file with multiple methods? The CRUD is tightly coupled
 * to one resource and Next.js App Router co-locates verbs in a route
 * file naturally. Splitting per-verb would just be ceremony.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const falPayloadSchema = z.object({ key: z.string().min(8).max(2_000) });
const higgsfieldPayloadSchema = z.object({
  key: z.string().min(4).max(2_000),
  secret: z.string().min(8).max(2_000),
});
const simplePayloadSchema = z.object({ key: z.string().min(8).max(2_000) });

type Json = Record<string, unknown>;

function parsePayload(provider: BYOKProvider, raw: unknown):
  | { ok: true; payload: Json; fingerprintSource: string }
  | { ok: false; message: string } {
  switch (provider) {
    case "fal":
    case "openai":
    case "anthropic":
    case "replicate":
    case "google": {
      const parsed = (provider === "fal" ? falPayloadSchema : simplePayloadSchema).safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          message: parsed.error.issues[0]?.message ?? "Invalid key payload",
        };
      }
      return {
        ok: true,
        payload: { key: parsed.data.key.trim() },
        fingerprintSource: parsed.data.key.trim(),
      };
    }
    case "higgsfield": {
      const parsed = higgsfieldPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          message: parsed.error.issues[0]?.message ?? "Invalid key payload",
        };
      }
      return {
        ok: true,
        payload: {
          key: parsed.data.key.trim(),
          secret: parsed.data.secret.trim(),
        },
        fingerprintSource: `${parsed.data.key.trim()}:${parsed.data.secret.trim()}`,
      };
    }
    default: {
      const _: never = provider;
      void _;
      return { ok: false, message: "Unknown provider" };
    }
  }
}

function badRequest(message: string): NextResponse {
  return NextResponse.json(
    { error: message, code: "invalid_request" },
    { status: 400 },
  );
}

/**
 * Reads `?provider=` from the request URL. We parse the URL with
 * `URL` (instead of `req.nextUrl.searchParams`) because the latter
 * only exists on `NextRequest` and unit tests pass plain `Request`.
 */
function readProviderQuery(req: NextRequest): string | null {
  try {
    return new URL(req.url).searchParams.get("provider");
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const __auth = await requireUser(req);
  if (__auth instanceof NextResponse) return __auth;

  try {
    const repo = buildBYOKRepository(__auth.accessToken);
    const rows = await repo.list(__auth.userId);
    return NextResponse.json(
      { keys: rows, supportedProviders: BYOK_PROVIDERS },
      { status: 200 },
    );
  } catch (err) {
    console.error("[api/byok/keys] GET failed:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "List failed", code: "unknown" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const __auth = await requireUser(req);
  if (__auth instanceof NextResponse) return __auth;

  let body: { provider?: unknown; payload?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Body must be JSON");
  }
  if (!isBYOKProvider(body.provider)) {
    return badRequest(
      `provider must be one of: ${BYOK_PROVIDERS.join(", ")}`,
    );
  }
  const payload = parsePayload(body.provider, body.payload);
  if (!payload.ok) return badRequest(payload.message);

  // Validate against the live provider before we persist. We DO NOT
  // skip on transient failures — a real upstream outage at this exact
  // moment is rare; far more likely the user pasted a bad key.
  const validation = await validateProviderKey(
    body.provider,
    payload.payload as never,
  );
  if (!validation.ok && !validation.skipped) {
    return NextResponse.json(
      {
        error: validation.reason ?? "Key validation failed",
        code: "invalid_key",
      },
      { status: 400 },
    );
  }

  try {
    const repo = buildBYOKRepository(__auth.accessToken);
    const record = await repo.upsert(
      __auth.userId,
      body.provider,
      payload.payload as never,
      payload.fingerprintSource,
    );
    return NextResponse.json(
      {
        record,
        validated: !validation.skipped,
        fingerprint: fingerprint(payload.fingerprintSource),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[api/byok/keys] POST failed:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Save failed", code: "unknown" },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({ enabled: z.boolean() });

export async function PATCH(req: NextRequest) {
  const __auth = await requireUser(req);
  if (__auth instanceof NextResponse) return __auth;

  const provider = readProviderQuery(req);
  if (!isBYOKProvider(provider)) {
    return badRequest(
      `provider query param must be one of: ${BYOK_PROVIDERS.join(", ")}`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Body must be JSON");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  try {
    const repo = buildBYOKRepository(__auth.accessToken);
    const record = await repo.setEnabled(
      __auth.userId,
      provider,
      parsed.data.enabled,
    );
    return NextResponse.json({ record }, { status: 200 });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "not_found") {
      return NextResponse.json(
        { error: "No saved key for this provider", code: "not_found" },
        { status: 404 },
      );
    }
    console.error("[api/byok/keys] PATCH failed:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Toggle failed", code: "unknown" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const __auth = await requireUser(req);
  if (__auth instanceof NextResponse) return __auth;

  const provider = readProviderQuery(req);
  if (!isBYOKProvider(provider)) {
    return badRequest(
      `provider query param must be one of: ${BYOK_PROVIDERS.join(", ")}`,
    );
  }

  try {
    const repo = buildBYOKRepository(__auth.accessToken);
    await repo.remove(__auth.userId, provider);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[api/byok/keys] DELETE failed:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Delete failed", code: "unknown" },
      { status: 500 },
    );
  }
}
