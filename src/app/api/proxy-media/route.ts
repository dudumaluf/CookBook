import { NextResponse, type NextRequest } from "next/server";

/**
 * GET /api/proxy-media?url=<encoded absolute url>
 *
 * Same-origin media relay (ADR-0087). Browser-side canvas / WebCodecs ops
 * (Resize Image, the compositors, the Composer) need the raw bytes via
 * `fetch` → `createImageBitmap`, but a cross-origin `fetch` is blocked unless
 * the host returns CORS headers. Supabase's Storage CDN intermittently serves
 * a *cached, header-less* response (warmed by the `<img>` preview, which the
 * browser fetches without an `Origin`), and external CDNs (fal, CloudFront,
 * Higgsfield) send no CORS at all — so the picture *displays* fine while a
 * later `fetch()` dies with `net::ERR_FAILED` ("Failed to fetch"). Routing the
 * byte-fetch through our own origin makes CORS irrelevant: the server has no
 * such restriction, and the response comes back same-origin.
 *
 * Safety:
 *   - Host allowlist (known public media CDNs) → no SSRF to internal hosts.
 *   - http(s) only.
 *   - Content-Type must be `image|video|audio/*` → rejects HTML/JSON/text,
 *     which also neutralises any redirect-to-metadata SSRF (the cloud
 *     metadata endpoint answers text/JSON, never a media type).
 *   - Streams the upstream body (edge runtime) so 25 MB+ sources are never
 *     buffered into memory or capped by the serverless response-size limit.
 *
 * Read-only relay of already-public bytes from allow-listed CDNs, so it is
 * intentionally unauthenticated — that keeps the edge path lean and avoids a
 * Supabase auth round-trip on every fallback image load.
 */

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Apex domains we relay from. A host matches when it equals an apex or is a
 * sub-domain of one (`<x>.supabase.co`, `cdn.fal.media`, …). Restricting to
 * these public media CDNs is what blocks SSRF to internal/loopback hosts.
 */
const ALLOWED_HOST_APEXES = [
  "supabase.co",
  "supabase.in",
  "fal.media",
  "fal.run",
  "fal.ai",
  "cloudfront.net",
  "higgsfield.ai",
];

export function isAllowedMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ALLOWED_HOST_APEXES.some(
    (apex) => h === apex || h.endsWith(`.${apex}`),
  );
}

function bad(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest): Promise<Response> {
  const target = new URL(req.url).searchParams.get("url");
  if (!target) return bad(400, "Missing `url` query parameter.");

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return bad(400, "Invalid `url`.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return bad(400, "Only http(s) URLs can be proxied.");
  }
  if (!isAllowedMediaHost(parsed.hostname)) {
    return bad(403, `Host not allowed: ${parsed.hostname}`);
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: req.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    return bad(502, `Upstream fetch failed: ${message}`);
  }

  if (!upstream.ok) {
    return bad(
      upstream.status === 404 ? 404 : 502,
      `Upstream responded ${upstream.status}.`,
    );
  }

  const contentType =
    upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  if (!/^(image|video|audio)\//.test(contentType)) {
    return bad(
      415,
      `Refusing to proxy non-media content-type: ${contentType || "unknown"}`,
    );
  }

  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("cache-control", "private, max-age=300");
  // Pass through cheap caching/diagnostic headers when present (harmless).
  for (const h of ["content-length", "etag", "last-modified"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  return new NextResponse(upstream.body, { status: 200, headers });
}
