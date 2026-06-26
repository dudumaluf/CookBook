import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, isAllowedMediaHost } from "@/app/api/proxy-media/route";

/**
 * Route tests for `GET /api/proxy-media` (ADR-0087) — the same-origin media
 * relay that fixes the Supabase-CDN CORS-cache bug. We assert the safety gates
 * (host allowlist → SSRF block, http(s) only, media-only content-type) and the
 * happy-path pass-through, mocking the upstream `fetch`.
 */

function request(target?: string): Request {
  const base = "http://localhost/api/proxy-media";
  const url = target ? `${base}?url=${encodeURIComponent(target)}` : base;
  return new Request(url);
}

const call = (target?: string) => GET(request(target) as never);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isAllowedMediaHost", () => {
  it("allows known media CDNs (apex + sub-domains)", () => {
    expect(isAllowedMediaHost("bnstnamdtlveluavjkcy.supabase.co")).toBe(true);
    expect(isAllowedMediaHost("cdn.fal.media")).toBe(true);
    expect(isAllowedMediaHost("v3.fal.media")).toBe(true);
    expect(isAllowedMediaHost("d123.cloudfront.net")).toBe(true);
    expect(isAllowedMediaHost("platform.higgsfield.ai")).toBe(true);
  });

  it("rejects internal / look-alike / arbitrary hosts (SSRF guard)", () => {
    expect(isAllowedMediaHost("169.254.169.254")).toBe(false);
    expect(isAllowedMediaHost("localhost")).toBe(false);
    expect(isAllowedMediaHost("evil.com")).toBe(false);
    // Suffix-confusion attempts must not slip through.
    expect(isAllowedMediaHost("supabase.co.evil.com")).toBe(false);
    expect(isAllowedMediaHost("notsupabase.co")).toBe(false);
  });
});

describe("GET /api/proxy-media — validation", () => {
  it("400 when `url` is missing", async () => {
    const r = await call();
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Missing `url`/);
  });

  it("400 when `url` is not a valid URL", async () => {
    const r = await call("not a url");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Invalid/);
  });

  it("400 for non-http(s) protocols", async () => {
    const r = await call("file:///etc/passwd");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/http\(s\)/);
  });

  it("403 for a host outside the allowlist", async () => {
    const r = await call("https://evil.com/x.png");
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/Host not allowed/);
  });
});

describe("GET /api/proxy-media — proxying", () => {
  it("streams allow-listed media back with its content-type", async () => {
    const upstream = new Response("PNGBYTES", {
      status: 200,
      headers: { "content-type": "image/png" },
    });
    const fetchMock = vi.fn(async () => upstream);
    vi.stubGlobal("fetch", fetchMock);

    const target = "https://abc.supabase.co/storage/v1/object/public/x.png";
    const r = await call(target);

    expect(fetchMock).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ redirect: "follow" }),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(await r.text()).toBe("PNGBYTES");
  });

  it("415 when the upstream content-type is not media (redirect-to-metadata guard)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );

    const r = await call("https://cdn.fal.media/x.png");
    expect(r.status).toBe(415);
    expect((await r.json()).error).toMatch(/non-media content-type/);
  });

  it("404 passes through, other upstream failures become 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    expect((await call("https://cdn.fal.media/missing.png")).status).toBe(404);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    expect((await call("https://cdn.fal.media/boom.png")).status).toBe(502);
  });

  it("502 when the upstream fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    const r = await call("https://cdn.fal.media/x.png");
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/Upstream fetch failed/);
  });
});
