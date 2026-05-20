import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler tests. We mock the server wrapper so we only exercise
 * the route's responsibilities — body parsing, Zod validation,
 * error → HTTP mapping. The wrapper itself has its own unit tests.
 */

// `vi.mock` is hoisted above all imports, so any variable it references
// must come from `vi.hoisted()` (which is also hoisted) — otherwise we
// crash with "Cannot access X before initialization".
const { callFalOpenRouter } = vi.hoisted(() => ({
  callFalOpenRouter: vi.fn(),
}));
vi.mock("@/lib/llm/fal-openrouter", () => ({
  callFalOpenRouter,
}));

import { POST } from "@/app/api/fal/openrouter/route";

function makeRequest(body: unknown, init?: { aborted?: boolean }): Request {
  const ctrl = new AbortController();
  if (init?.aborted) ctrl.abort();
  return new Request("http://localhost/api/fal/openrouter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: ctrl.signal,
  });
}

beforeEach(() => {
  callFalOpenRouter.mockReset();
});

describe("POST /api/fal/openrouter", () => {
  it("returns 400 with code='invalid_request' when the body isn't JSON", async () => {
    const res = await POST(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Body must be JSON", code: "invalid_request" });
    expect(callFalOpenRouter).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await POST(
      makeRequest({ user: "go" }) as never, // missing `model`
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
    expect(body.error).toMatch(/model/i);
  });

  it("returns 400 when user prompt is empty", async () => {
    const res = await POST(
      makeRequest({ model: "test/m", user: "" }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
  });

  it("returns 400 when an image URL is not a valid URL", async () => {
    const res = await POST(
      makeRequest({
        model: "test/m",
        user: "go",
        images: ["not-a-url"],
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("forwards a valid request to the wrapper and returns its result as JSON", async () => {
    callFalOpenRouter.mockResolvedValueOnce({
      text: "real response",
      model: "test/m",
      costUsd: 0.001,
      inputTokens: 100,
      outputTokens: 50,
    });

    const res = await POST(
      makeRequest({
        model: "test/m",
        user: "hello",
        system: "be terse",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      text: "real response",
      model: "test/m",
      costUsd: 0.001,
      inputTokens: 100,
      outputTokens: 50,
    });

    expect(callFalOpenRouter).toHaveBeenCalledTimes(1);
    const args = callFalOpenRouter.mock.calls[0]!;
    expect(args[0]).toEqual({
      model: "test/m",
      user: "hello",
      system: "be terse",
    });
    // Signal is forwarded so a client disconnect propagates.
    expect(args[1]).toBeInstanceOf(AbortSignal);
  });

  it("returns 499 + code='aborted' when the wrapper throws AbortError", async () => {
    callFalOpenRouter.mockImplementationOnce(() => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const res = await POST(
      makeRequest({ model: "test/m", user: "go" }) as never,
    );
    expect(res.status).toBe(499);
    const body = await res.json();
    expect(body.code).toBe("aborted");
  });

  it("returns 500 + code='missing_key' when the server isn't configured", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    callFalOpenRouter.mockRejectedValueOnce(err);

    const res = await POST(
      makeRequest({ model: "test/m", user: "go" }) as never,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: "FAL_KEY missing",
      code: "missing_key",
    });
  });

  it("returns 502 + code='upstream_error' when Fal returns an error", async () => {
    const err = new Error("Fal OpenRouter error: rate limited");
    (err as Error & { code?: string }).code = "upstream_error";
    callFalOpenRouter.mockRejectedValueOnce(err);

    const res = await POST(
      makeRequest({ model: "test/m", user: "go" }) as never,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("upstream_error");
    expect(body.error).toMatch(/rate limited/);
  });

  /* Slice 3.4 — reasoning passes validation + forwards through ---- */

  it("accepts reasoning=true and forwards it to the wrapper", async () => {
    callFalOpenRouter.mockResolvedValueOnce({
      text: "thought through it",
      model: "google/gemini-2.5-pro",
    });

    const res = await POST(
      makeRequest({
        model: "google/gemini-2.5-pro",
        user: "go",
        reasoning: true,
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(callFalOpenRouter.mock.calls[0]![0]).toEqual({
      model: "google/gemini-2.5-pro",
      user: "go",
      reasoning: true,
    });
  });

  it("rejects a non-boolean reasoning at the schema layer (400)", async () => {
    const res = await POST(
      makeRequest({
        model: "test/m",
        user: "go",
        reasoning: "yes" as unknown as boolean,
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
    expect(callFalOpenRouter).not.toHaveBeenCalled();
  });

  it("returns 500 + code='unknown' and a generic message for unmapped errors", async () => {
    // Spy on console.error so the test output stays clean — the route
    // intentionally logs unknown failures so they show up in the Next
    // terminal during development.
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    callFalOpenRouter.mockRejectedValueOnce(
      new Error("internal stack trace leak"),
    );

    const res = await POST(
      makeRequest({ model: "test/m", user: "go" }) as never,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("unknown");
    // Generic message — the raw error never leaves the server.
    expect(body.error).toBe("LLM call failed");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
