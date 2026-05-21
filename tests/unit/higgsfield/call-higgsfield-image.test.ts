import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callHiggsfieldImage,
  fetchSoulIds,
  fetchSoulStyles,
  HiggsfieldCallError,
} from "@/lib/higgsfield/call-higgsfield-image";

/**
 * Client wrapper unit tests. The wrapper has these responsibilities to lock in:
 *   1. POST body shape (signal stripped before serialising).
 *   2. Success parsing.
 *   3. Structured-error parsing → `HiggsfieldCallError(code)`.
 *   4. Non-JSON failure body fallback message.
 *   5. 499 → `AbortError` translation (so the engine routes cancellation,
 *      not error).
 *   6. Local AbortError preserved (re-thrown unchanged).
 *   7. Network failure → `HiggsfieldCallError("network")`.
 *
 * Mirrors `tests/unit/llm/call-openrouter.test.ts` one-to-one.
 */

const realFetch = globalThis.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* --------------------------- callHiggsfieldImage --------------------------- */

describe("callHiggsfieldImage", () => {
  const signal = new AbortController().signal;

  it("posts a JSON body to /api/higgsfield/image without the signal field", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        imageUrls: ["https://x/a.png"],
        requestId: "r",
        model: "higgsfield-ai/soul/v2/standard",
      }),
    );

    await callHiggsfieldImage({
      prompt: "go",
      mode: "none",
      variant: "none",
      signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/higgsfield/image");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(init.signal).toBe(signal);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ prompt: "go", mode: "none", variant: "none" });
    expect(body.signal).toBeUndefined();
  });

  it("returns the parsed success body verbatim", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        imageUrls: ["https://x/a.png", "https://x/b.png"],
        requestId: "req-9",
        model: "higgsfield-ai/soul/v2/standard",
      }),
    );

    const result = await callHiggsfieldImage({
      prompt: "go",
      mode: "none",
      variant: "none",
      signal,
    });
    expect(result.imageUrls).toEqual([
      "https://x/a.png",
      "https://x/b.png",
    ]);
    expect(result.requestId).toBe("req-9");
  });

  it("maps a structured error body to HiggsfieldCallError with its code", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(502, {
        error: "Higgsfield 503 service unavailable",
        code: "upstream_error",
      }),
    );

    let caught: unknown;
    try {
      await callHiggsfieldImage({ prompt: "go", mode: "none", variant: "none", signal });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HiggsfieldCallError);
    expect((caught as HiggsfieldCallError).code).toBe("upstream_error");
    expect((caught as HiggsfieldCallError).message).toMatch(/service unavailable/);
  });

  it("propagates a 429 + code='concurrent_limit' as a typed HiggsfieldCallError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, {
        error:
          "Higgsfield: Maximum number of concurrent requests (4) has been reached",
        code: "concurrent_limit",
      }),
    );

    let caught: unknown;
    try {
      await callHiggsfieldImage({ prompt: "go", mode: "none", variant: "none", signal });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HiggsfieldCallError);
    expect((caught as HiggsfieldCallError).code).toBe("concurrent_limit");
    expect((caught as HiggsfieldCallError).message).toMatch(
      /concurrent requests/i,
    );
  });

  it("maps a non-JSON failure body to a generic message + code='unknown'", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>nginx 502</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(
      callHiggsfieldImage({ prompt: "go", mode: "none", variant: "none", signal }),
    ).rejects.toMatchObject({
      message: /HTTP 502/,
      code: "unknown",
    });
  });

  it("translates a 499 server response into AbortError (cancellation, not error)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(499, { error: "Request cancelled", code: "aborted" }),
    );

    await expect(
      callHiggsfieldImage({ prompt: "go", mode: "none", variant: "none", signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves a local fetch-level AbortError unchanged", async () => {
    fetchMock.mockImplementationOnce(() => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    await expect(
      callHiggsfieldImage({ prompt: "go", mode: "none", variant: "none", signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("maps a fetch-level network error to HiggsfieldCallError('network')", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("fetch failed")));

    await expect(
      callHiggsfieldImage({ prompt: "go", mode: "none", variant: "none", signal }),
    ).rejects.toMatchObject({ code: "network" });
  });
});

/* ------------------------------ fetchSoulIds ------------------------------ */

describe("fetchSoulIds", () => {
  it("returns the items array on success", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        items: [
          {
            id: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
            name: "Me",
            modelVersion: "v2",
            status: "completed",
            thumbnailUrl: null,
            createdAt: "2026-04-01T12:00:00Z",
          },
        ],
      }),
    );

    const items = await fetchSoulIds(new AbortController().signal);
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Me");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/higgsfield/soul-ids");
  });

  it("maps server-side missing_keys into a typed error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, {
        error: "HIGGSFIELD env vars missing",
        code: "missing_keys",
      }),
    );

    await expect(
      fetchSoulIds(new AbortController().signal),
    ).rejects.toMatchObject({ code: "missing_keys" });
  });

  it("maps a fetch-level network failure to HiggsfieldCallError('network')", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("fetch failed")));

    await expect(
      fetchSoulIds(new AbortController().signal),
    ).rejects.toMatchObject({ code: "network" });
  });
});

/* ------------------------------ fetchSoulStyles ------------------------------ */

describe("fetchSoulStyles", () => {
  it("returns the items array on success", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        items: [
          {
            id: "95151de0-e0e5-4e04-bd45-c58c8a4ac023",
            name: "Street photography",
            description: "",
            previewUrl: "https://cdn.example/street.webp",
          },
        ],
      }),
    );

    const items = await fetchSoulStyles(new AbortController().signal);
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Street photography");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "/api/higgsfield/soul-styles",
    );
  });

  it("maps server-side missing_keys into a typed error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, {
        error: "HIGGSFIELD env vars missing",
        code: "missing_keys",
      }),
    );

    await expect(
      fetchSoulStyles(new AbortController().signal),
    ).rejects.toMatchObject({ code: "missing_keys" });
  });

  it("translates a 499 server response into AbortError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(499, { error: "Request cancelled", code: "aborted" }),
    );

    await expect(
      fetchSoulStyles(new AbortController().signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("maps a fetch-level network failure to HiggsfieldCallError('network')", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("fetch failed")));

    await expect(
      fetchSoulStyles(new AbortController().signal),
    ).rejects.toMatchObject({ code: "network" });
  });
});
