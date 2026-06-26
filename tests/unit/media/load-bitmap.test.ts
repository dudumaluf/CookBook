import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchMediaBlob,
  loadBitmap,
  proxiedMediaUrl,
} from "@/lib/media/load-bitmap";

/**
 * `load-bitmap` is the CORS-safe media loader (ADR-0087): try the direct
 * cross-origin `fetch`, then transparently fall back to the same-origin
 * `/api/proxy-media` relay when the direct fetch is blocked ("Failed to
 * fetch") or fails. These tests pin that fallback contract with a stubbed
 * `fetch` (and `createImageBitmap` for the bitmap path).
 */

function pngBlob(text = "bytes"): Blob {
  return new Blob([text], { type: "image/png" });
}

/** A duck-typed Response carrying just what the loader reads (`ok`, `blob`). */
function res(ok: boolean, body: Blob, status = ok ? 200 : 500) {
  return { ok, status, blob: async () => body } as unknown as Response;
}

const isProxy = (input: unknown) =>
  String(input).startsWith("/api/proxy-media");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("proxiedMediaUrl", () => {
  it("encodes the target into the same-origin proxy path", () => {
    const target = "https://x.supabase.co/a b.png?v=1";
    expect(proxiedMediaUrl(target)).toBe(
      `/api/proxy-media?url=${encodeURIComponent(target)}`,
    );
  });
});

describe("fetchMediaBlob", () => {
  it("returns the direct blob and never touches the proxy on a CORS-friendly host", async () => {
    const direct = pngBlob("direct");
    const fetchMock = vi.fn<(input: unknown) => Promise<Response>>(async () =>
      res(true, direct),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchMediaBlob("https://cdn.example/ok.png");

    expect(out).toBe(direct);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isProxy(fetchMock.mock.calls[0]![0])).toBe(false);
  });

  it("falls back to the proxy when the direct fetch is CORS-blocked (throws)", async () => {
    const proxied = pngBlob("via-proxy");
    const fetchMock = vi.fn(async (input: unknown) => {
      if (isProxy(input)) return res(true, proxied);
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchMediaBlob("https://cdn.fal.media/x.png");

    expect(out).toBe(proxied);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(isProxy(fetchMock.mock.calls[1]![0])).toBe(true);
  });

  it("falls back to the proxy when the direct fetch returns a non-OK status", async () => {
    const proxied = pngBlob("via-proxy");
    const fetchMock = vi.fn(async (input: unknown) =>
      isProxy(input) ? res(true, proxied) : res(false, pngBlob(), 403),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchMediaBlob("https://cdn.fal.media/x.png");

    expect(out).toBe(proxied);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error when both the direct fetch and the proxy fail", async () => {
    const fetchMock = vi.fn(async (input: unknown) =>
      isProxy(input) ? res(false, pngBlob(), 502) : res(false, pngBlob(), 403),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchMediaBlob("https://cdn.fal.media/missing.png"),
    ).rejects.toThrow(/Failed to load media \(403\)/);
  });

  it("rethrows an AbortError without falling back to the proxy", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchMediaBlob("https://cdn.fal.media/x.png"),
    ).rejects.toThrow(/aborted/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("loadBitmap", () => {
  it("decodes the fetched bytes via createImageBitmap", async () => {
    const direct = pngBlob("img");
    vi.stubGlobal("fetch", vi.fn(async () => res(true, direct)));
    const sentinel = { width: 4, height: 2 } as unknown as ImageBitmap;
    const createBitmap = vi.fn(async () => sentinel);
    vi.stubGlobal("createImageBitmap", createBitmap);

    const bmp = await loadBitmap("https://x.supabase.co/img.png");

    expect(bmp).toBe(sentinel);
    expect(createBitmap).toHaveBeenCalledWith(direct);
  });
});
