import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitH3Max, getH3MaxResult } = vi.hoisted(() => ({
  submitH3Max: vi.fn(),
  getH3MaxResult: vi.fn(),
}));
vi.mock("@/lib/fal/h3-max-api", () => ({
  submitH3Max,
  getH3MaxResult,
}));

import { POST as SUBMIT } from "@/app/api/fal/h3-max/route";
import { POST as STATUS } from "@/app/api/fal/h3-max/status/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/fal/h3-max", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  submitH3Max.mockReset();
  getH3MaxResult.mockReset();
});

describe("POST /api/fal/h3-max (submit)", () => {
  it("returns 400 on non-JSON", async () => {
    const res = await SUBMIT(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("returns 400 when imageUrl is missing", async () => {
    const res = await SUBMIT(makeRequest({ prompt: "x" }) as never);
    expect(res.status).toBe(400);
  });

  it("submits a valid request and returns the request id", async () => {
    submitH3Max.mockResolvedValueOnce({
      requestId: "req-h3",
      endpoint: "minimax/h3-max/image-to-video",
    });
    const res = await SUBMIT(
      makeRequest({
        prompt: "pull back",
        imageUrl: "https://x/start.png",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe("req-h3");
    expect(submitH3Max).toHaveBeenCalledTimes(1);
  });

  it("maps missing_key to 500", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    submitH3Max.mockRejectedValueOnce(err);
    const res = await SUBMIT(
      makeRequest({
        prompt: "go",
        imageUrl: "https://x/a.png",
      }) as never,
    );
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("missing_key");
  });
});

describe("POST /api/fal/h3-max/status (poll)", () => {
  it("returns 400 when the body is missing fields", async () => {
    const res = await STATUS(makeRequest({ requestId: "r" }) as never);
    expect(res.status).toBe(400);
  });

  it("returns pending while the job renders", async () => {
    getH3MaxResult.mockResolvedValueOnce({ status: "pending" });
    const res = await STATUS(
      makeRequest({
        endpoint: "minimax/h3-max/image-to-video",
        requestId: "r1",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending");
  });

  it("returns the video when done", async () => {
    getH3MaxResult.mockResolvedValueOnce({
      status: "done",
      videoUrl: "https://cdn.fal.media/h3.mp4",
      mime: "video/mp4",
      model: "minimax/h3-max/image-to-video",
    });
    const res = await STATUS(
      makeRequest({
        endpoint: "minimax/h3-max/image-to-video",
        requestId: "r1",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.videoUrl).toBe("https://cdn.fal.media/h3.mp4");
  });
});
