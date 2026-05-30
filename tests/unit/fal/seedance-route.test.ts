import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler tests for the async Seedance queue (ADR-0057):
 *   POST /api/fal/seedance         → submit
 *   POST /api/fal/seedance/status  → poll
 * Mocks the server wrapper so we only exercise body parsing + error mapping.
 */

const { submitSeedanceVideo, getSeedanceResult } = vi.hoisted(() => ({
  submitSeedanceVideo: vi.fn(),
  getSeedanceResult: vi.fn(),
}));
vi.mock("@/lib/fal/seedance-api", () => ({
  submitSeedanceVideo,
  getSeedanceResult,
}));

import { POST as SUBMIT } from "@/app/api/fal/seedance/route";
import { POST as STATUS } from "@/app/api/fal/seedance/status/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/fal/seedance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  submitSeedanceVideo.mockReset();
  getSeedanceResult.mockReset();
});

describe("POST /api/fal/seedance (submit)", () => {
  it("returns 400 on non-JSON", async () => {
    const res = await SUBMIT(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("returns 400 when imageUrls exceeds the cap", async () => {
    const res = await SUBMIT(
      makeRequest({
        prompt: "x",
        imageUrls: Array.from({ length: 10 }, (_, i) => `https://x/${i}.png`),
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("submits a valid request and returns the request id + endpoint", async () => {
    submitSeedanceVideo.mockResolvedValueOnce({
      requestId: "req-9",
      endpoint: "bytedance/seedance-2.0/text-to-video",
    });
    const res = await SUBMIT(makeRequest({ prompt: "an octopus" }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe("req-9");
    expect(submitSeedanceVideo).toHaveBeenCalledTimes(1);
  });

  it("maps missing_key to 500", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    submitSeedanceVideo.mockRejectedValueOnce(err);
    const res = await SUBMIT(makeRequest({ prompt: "go" }) as never);
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("missing_key");
  });
});

describe("POST /api/fal/seedance/status (poll)", () => {
  it("returns 400 when the body is missing fields", async () => {
    const res = await STATUS(makeRequest({ requestId: "r" }) as never);
    expect(res.status).toBe(400);
  });

  it("returns pending while the job renders", async () => {
    getSeedanceResult.mockResolvedValueOnce({ status: "pending" });
    const res = await STATUS(
      makeRequest({ endpoint: "ep", requestId: "r" }) as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending");
  });

  it("returns the video when done", async () => {
    getSeedanceResult.mockResolvedValueOnce({
      status: "done",
      videoUrl: "https://cdn.fal.media/clip.mp4",
      model: "ep",
    });
    const res = await STATUS(
      makeRequest({ endpoint: "ep", requestId: "r" }) as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).videoUrl).toBe("https://cdn.fal.media/clip.mp4");
  });

  it("maps an upstream failure to 502", async () => {
    const err = new Error("Fal: boom");
    (err as Error & { code?: string }).code = "upstream_error";
    getSeedanceResult.mockRejectedValueOnce(err);
    const res = await STATUS(
      makeRequest({ endpoint: "ep", requestId: "r" }) as never,
    );
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("upstream_error");
  });
});
