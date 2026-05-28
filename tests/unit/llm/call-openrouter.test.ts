import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  callOpenRouter,
  LlmCallError,
} from "@/lib/llm/call-openrouter";

/**
 * Unit tests for the browser-side fetch wrapper around POST /api/fal/openrouter.
 *
 * We mock `globalThis.fetch` rather than spinning up MSW for these — the
 * wrapper has no other side-effects and its job is strictly request
 * shaping + error normalisation, both of which are easier to assert
 * with explicit `mockFetch.mock.calls` inspection.
 */

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

function okResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errResponse(
  status: number,
  body: Record<string, unknown> | null,
): Response {
  return new Response(body ? JSON.stringify(body) : "not json", {
    status,
    headers: { "Content-Type": body ? "application/json" : "text/plain" },
  });
}

describe("callOpenRouter", () => {
  it("POSTs the body (without the signal) to /api/fal/openrouter", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ text: "hi", model: "test/m" }),
    );

    const signal = new AbortController().signal;
    await callOpenRouter({
      model: "test/m",
      user: "hello",
      system: "be terse",
      signal,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("/api/llm/chat-completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    // signal forwarded so React's StrictMode / engine cancellation works.
    expect(init.signal).toBe(signal);

    // Body is the LlmRequest shape, signal stripped.
    const sent = JSON.parse(init.body);
    expect(sent).toEqual({
      model: "test/m",
      user: "hello",
      system: "be terse",
    });
    expect(sent).not.toHaveProperty("signal");
  });

  it("forwards image URLs in the request body", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ text: "ok", model: "test/m" }),
    );
    await callOpenRouter({
      model: "test/m",
      user: "describe",
      images: ["https://example.com/a.png", "https://example.com/b.png"],
      signal: new AbortController().signal,
    });
    const init = mockFetch.mock.calls[0]![1];
    expect(JSON.parse(init.body).images).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ]);
  });

  it("returns the parsed success body", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        text: "real response",
        model: "test/m",
        costUsd: 0.0012,
        inputTokens: 120,
        outputTokens: 80,
      }),
    );
    const result = await callOpenRouter({
      model: "test/m",
      user: "go",
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      text: "real response",
      model: "test/m",
      costUsd: 0.0012,
      inputTokens: 120,
      outputTokens: 80,
    });
  });

  it("throws LlmCallError with the server's error message + code on non-OK JSON", async () => {
    mockFetch.mockResolvedValueOnce(
      errResponse(400, {
        error: "model is required",
        code: "invalid_request",
      }),
    );
    await expect(
      callOpenRouter({
        model: "",
        user: "go",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "LlmCallError",
      message: "model is required",
      code: "invalid_request",
    });
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    mockFetch.mockResolvedValueOnce(errResponse(502, null));
    await expect(
      callOpenRouter({
        model: "test/m",
        user: "go",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "LlmCallError",
      message: /HTTP 502/,
      code: "unknown",
    });
  });

  it("translates 499 (server-side cancellation) into a real AbortError", async () => {
    mockFetch.mockResolvedValueOnce(
      errResponse(499, { error: "Request cancelled", code: "aborted" }),
    );
    await expect(
      callOpenRouter({
        model: "test/m",
        user: "go",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("re-throws AbortError unchanged when fetch itself aborts", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortErr);

    await expect(
      callOpenRouter({
        model: "test/m",
        user: "go",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("translates non-abort network failures into LlmCallError(code='network')", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      callOpenRouter({
        model: "test/m",
        user: "go",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "LlmCallError",
      code: "network",
    });
  });

  it("LlmCallError is a real Error subclass (passes instanceof / has name)", async () => {
    mockFetch.mockResolvedValueOnce(
      errResponse(500, { error: "boom", code: "upstream_error" }),
    );
    try {
      await callOpenRouter({
        model: "test/m",
        user: "go",
        signal: new AbortController().signal,
      });
      expect.fail("expected LlmCallError");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmCallError);
      expect((err as LlmCallError).code).toBe("upstream_error");
    }
  });
});
