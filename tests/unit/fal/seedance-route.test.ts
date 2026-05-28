import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler tests for `POST /api/fal/seedance`. Mocks the server wrapper
 * so we only exercise body parsing, Zod validation, and error -> HTTP
 * mapping. Mirrors the Higgsfield image-route test.
 */

const { generateSeedanceVideo } = vi.hoisted(() => ({
  generateSeedanceVideo: vi.fn(),
}));
vi.mock("@/lib/fal/seedance-api", () => ({ generateSeedanceVideo }));

import { POST } from "@/app/api/fal/seedance/route";

function makeRequest(body: unknown, init?: { aborted?: boolean }): Request {
  const ctrl = new AbortController();
  if (init?.aborted) ctrl.abort();
  return new Request("http://localhost/api/fal/seedance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: ctrl.signal,
  });
}

beforeEach(() => {
  generateSeedanceVideo.mockReset();
});

describe("POST /api/fal/seedance", () => {
  it("returns 400 when the body isn't JSON", async () => {
    const res = await POST(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
    expect(generateSeedanceVideo).not.toHaveBeenCalled();
  });

  it("returns 400 when imageUrls exceeds the cap", async () => {
    const res = await POST(
      makeRequest({
        prompt: "x",
        imageUrls: Array.from({ length: 10 }, (_, i) => `https://x/${i}.png`),
      }) as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("returns 400 when duration is out of range", async () => {
    const res = await POST(
      makeRequest({ prompt: "x", duration: 30 }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("forwards a valid request and returns the result", async () => {
    generateSeedanceVideo.mockResolvedValueOnce({
      videoUrl: "https://cdn.fal.media/clip.mp4",
      mime: "video/mp4",
      seed: 42,
      model: "bytedance/seedance-2.0/text-to-video",
    });
    const res = await POST(
      makeRequest({ prompt: "an octopus playing football" }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videoUrl).toBe("https://cdn.fal.media/clip.mp4");
    expect(generateSeedanceVideo).toHaveBeenCalledTimes(1);
    const [, signal] = generateSeedanceVideo.mock.calls[0]!;
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 499 when the wrapper throws AbortError", async () => {
    generateSeedanceVideo.mockImplementationOnce(() => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    const res = await POST(makeRequest({ prompt: "go" }) as never);
    expect(res.status).toBe(499);
    expect((await res.json()).code).toBe("aborted");
  });

  it("returns 500 + missing_key when FAL_KEY is absent", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    generateSeedanceVideo.mockRejectedValueOnce(err);
    const res = await POST(makeRequest({ prompt: "go" }) as never);
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("missing_key");
  });

  it("returns 502 + upstream_error on a Fal failure", async () => {
    const err = new Error("Fal: validation error");
    (err as Error & { code?: string }).code = "upstream_error";
    generateSeedanceVideo.mockRejectedValueOnce(err);
    const res = await POST(makeRequest({ prompt: "go" }) as never);
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("upstream_error");
  });

  it("returns 500 + unknown for unmapped errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    generateSeedanceVideo.mockRejectedValueOnce(new Error("stack leak"));
    const res = await POST(makeRequest({ prompt: "go" }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("unknown");
    expect(body.error).toBe("Video generation failed");
    errorSpy.mockRestore();
  });
});
