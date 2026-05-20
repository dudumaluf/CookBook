import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler tests for `POST /api/higgsfield/image`. We mock the server
 * wrapper so we only exercise the route's responsibilities — body parsing,
 * Zod validation (including the `superRefine` cross-field rules for mode
 * vs referenceUrl/styleId), and error → HTTP mapping. The wrapper itself
 * has its own unit tests.
 *
 * Mirrors the Fal route test (`tests/unit/llm/route.test.ts`) one-to-one.
 */

const { generateSoulImage } = vi.hoisted(() => ({
  generateSoulImage: vi.fn(),
}));
vi.mock("@/lib/higgsfield/higgsfield-api", () => ({ generateSoulImage }));

import { POST } from "@/app/api/higgsfield/image/route";

function makeRequest(body: unknown, init?: { aborted?: boolean }): Request {
  const ctrl = new AbortController();
  if (init?.aborted) ctrl.abort();
  return new Request("http://localhost/api/higgsfield/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: ctrl.signal,
  });
}

beforeEach(() => {
  generateSoulImage.mockReset();
});

describe("POST /api/higgsfield/image", () => {
  it("returns 400 with code='invalid_request' when the body isn't JSON", async () => {
    const res = await POST(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Body must be JSON", code: "invalid_request" });
    expect(generateSoulImage).not.toHaveBeenCalled();
  });

  it("returns 400 when the prompt is missing", async () => {
    const res = await POST(makeRequest({ mode: "none" }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
    expect(body.error).toMatch(/prompt/i);
  });

  it("returns 400 when mode='reference' but no referenceUrl is supplied", async () => {
    const res = await POST(
      makeRequest({ prompt: "hi", mode: "reference" }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
    expect(body.error).toMatch(/referenceUrl/);
  });

  it("returns 400 when mode='style' but no styleId is supplied", async () => {
    const res = await POST(
      makeRequest({ prompt: "hi", mode: "style" }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
    expect(body.error).toMatch(/styleId/);
  });

  it("returns 400 when mode='none' but referenceUrl is set (cross-field guard)", async () => {
    const res = await POST(
      makeRequest({
        prompt: "hi",
        mode: "none",
        referenceUrl: "https://example.com/ref.jpg",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
  });

  it("returns 400 when mode='reference' but styleId is also set", async () => {
    const res = await POST(
      makeRequest({
        prompt: "hi",
        mode: "reference",
        referenceUrl: "https://example.com/ref.jpg",
        styleId: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
    expect(body.error).toMatch(/styleId/);
  });

  it("returns 400 when soulId is not a valid UUID", async () => {
    const res = await POST(
      makeRequest({
        prompt: "hi",
        mode: "none",
        soulId: "not-a-uuid",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
  });

  it("returns 400 when seed is out of [1, 1_000_000]", async () => {
    const res = await POST(
      makeRequest({
        prompt: "hi",
        mode: "none",
        seed: 9_999_999,
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
  });

  it("forwards a valid request to the wrapper and returns its result as JSON", async () => {
    generateSoulImage.mockResolvedValueOnce({
      imageUrls: ["https://cdn.example/a.png", "https://cdn.example/b.png"],
      requestId: "req-1",
      model: "higgsfield-ai/soul/v2/standard",
    });

    const res = await POST(
      makeRequest({
        prompt: "warm light, soft focus",
        mode: "reference",
        referenceUrl: "https://example.com/ref.jpg",
        soulId: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
        aspectRatio: "1:1",
        resolution: "720p",
        batchSize: 4,
        seed: 12345,
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      imageUrls: ["https://cdn.example/a.png", "https://cdn.example/b.png"],
      requestId: "req-1",
      model: "higgsfield-ai/soul/v2/standard",
    });

    expect(generateSoulImage).toHaveBeenCalledTimes(1);
    const [args, signal] = generateSoulImage.mock.calls[0]!;
    expect(args).toEqual({
      prompt: "warm light, soft focus",
      mode: "reference",
      referenceUrl: "https://example.com/ref.jpg",
      soulId: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
      aspectRatio: "1:1",
      resolution: "720p",
      batchSize: 4,
      seed: 12345,
    });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 499 + code='aborted' when the wrapper throws AbortError", async () => {
    generateSoulImage.mockImplementationOnce(() => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const res = await POST(
      makeRequest({ prompt: "go", mode: "none" }) as never,
    );
    expect(res.status).toBe(499);
    const body = await res.json();
    expect(body.code).toBe("aborted");
  });

  it("returns 500 + code='missing_keys' when env vars are absent", async () => {
    const err = new Error(
      "HIGGSFIELD_API_KEY / HIGGSFIELD_API_SECRET missing",
    );
    (err as Error & { code?: string }).code = "missing_keys";
    generateSoulImage.mockRejectedValueOnce(err);

    const res = await POST(
      makeRequest({ prompt: "go", mode: "none" }) as never,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: "HIGGSFIELD_API_KEY / HIGGSFIELD_API_SECRET missing",
      code: "missing_keys",
    });
  });

  it("returns 502 + code='nsfw' when content moderation rejects", async () => {
    const err = new Error("Higgsfield rejected the request as NSFW");
    (err as Error & { code?: string }).code = "nsfw";
    generateSoulImage.mockRejectedValueOnce(err);

    const res = await POST(
      makeRequest({ prompt: "go", mode: "none" }) as never,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("nsfw");
  });

  it("returns 502 + code='upstream_failed' on terminal generation failure", async () => {
    const err = new Error("Higgsfield generation failed");
    (err as Error & { code?: string }).code = "upstream_failed";
    generateSoulImage.mockRejectedValueOnce(err);

    const res = await POST(
      makeRequest({ prompt: "go", mode: "none" }) as never,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("upstream_failed");
  });

  it("returns 502 + code='upstream_error' on non-2xx upstream", async () => {
    const err = new Error("Higgsfield 500: server error");
    (err as Error & { code?: string }).code = "upstream_error";
    generateSoulImage.mockRejectedValueOnce(err);

    const res = await POST(
      makeRequest({ prompt: "go", mode: "none" }) as never,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("upstream_error");
  });

  it("returns 429 + code='concurrent_limit' when Higgsfield's per-keypair cap is full", async () => {
    const err = new Error(
      "Higgsfield: Maximum number of concurrent requests (4) has been reached",
    );
    (err as Error & { code?: string }).code = "concurrent_limit";
    generateSoulImage.mockRejectedValueOnce(err);

    const res = await POST(
      makeRequest({ prompt: "go", mode: "none" }) as never,
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("concurrent_limit");
    expect(body.error).toMatch(/concurrent requests/i);
  });

  it("returns 502 + code='timeout' when the poll loop exceeds the budget", async () => {
    const err = new Error("Higgsfield request did not finish within 360000ms");
    (err as Error & { code?: string }).code = "timeout";
    generateSoulImage.mockRejectedValueOnce(err);

    const res = await POST(
      makeRequest({ prompt: "go", mode: "none" }) as never,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("timeout");
  });

  it("returns 500 + code='unknown' and a generic message for unmapped errors", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    generateSoulImage.mockRejectedValueOnce(
      new Error("internal stack trace leak"),
    );

    const res = await POST(
      makeRequest({ prompt: "go", mode: "none" }) as never,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("unknown");
    expect(body.error).toBe("Image generation failed");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
