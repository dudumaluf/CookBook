import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitSam31Video, getSam31VideoResult } = vi.hoisted(() => ({
  submitSam31Video: vi.fn(),
  getSam31VideoResult: vi.fn(),
}));
vi.mock("@/lib/fal/sam31-video-api", () => ({
  submitSam31Video,
  getSam31VideoResult,
}));

import { POST as SUBMIT } from "@/app/api/fal/sam-3-1-video/route";
import { POST as STATUS } from "@/app/api/fal/sam-3-1-video/status/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/fal/sam-3-1-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  submitSam31Video.mockReset();
  getSam31VideoResult.mockReset();
});

describe("POST /api/fal/sam-3-1-video (submit)", () => {
  it("returns 400 on non-JSON", async () => {
    const res = await SUBMIT(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when videoUrl is missing", async () => {
    const res = await SUBMIT(makeRequest({ prompt: "person" }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when detectionThreshold is out of range", async () => {
    const res = await SUBMIT(
      makeRequest({
        videoUrl: "https://x/v.mp4",
        detectionThreshold: 5,
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("accepts a minimal request (video only)", async () => {
    submitSam31Video.mockResolvedValueOnce({
      requestId: "req-1",
      endpoint: "fal-ai/sam-3-1/video",
    });
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/v.mp4" }) as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).requestId).toBe("req-1");
    expect(submitSam31Video).toHaveBeenCalledTimes(1);
  });

  it("submits a full request with prompt + applyMask + threshold", async () => {
    submitSam31Video.mockResolvedValueOnce({
      requestId: "req-2",
      endpoint: "fal-ai/sam-3-1/video",
    });
    const res = await SUBMIT(
      makeRequest({
        videoUrl: "https://x/v.mp4",
        prompt: "person, cloth",
        applyMask: true,
        detectionThreshold: 0.3,
        maxNumObjects: 8,
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(submitSam31Video).toHaveBeenCalledWith(
      expect.objectContaining({
        videoUrl: "https://x/v.mp4",
        prompt: "person, cloth",
        applyMask: true,
        detectionThreshold: 0.3,
        maxNumObjects: 8,
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("accepts and forwards a visual box prompt", async () => {
    submitSam31Video.mockResolvedValueOnce({
      requestId: "req-3",
      endpoint: "fal-ai/sam-3-1/video",
    });
    const res = await SUBMIT(
      makeRequest({
        videoUrl: "https://x/v.mp4",
        boxPrompts: [{ xMin: 10, yMin: 20, xMax: 200, yMax: 180 }],
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(submitSam31Video).toHaveBeenCalledWith(
      expect.objectContaining({
        boxPrompts: [{ xMin: 10, yMin: 20, xMax: 200, yMax: 180 }],
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("returns 400 on a negative box coordinate", async () => {
    const res = await SUBMIT(
      makeRequest({
        videoUrl: "https://x/v.mp4",
        boxPrompts: [{ xMin: -5, yMin: 10, xMax: 100, yMax: 100 }],
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("maps upstream_error to 502", async () => {
    const err = new Error("Fal: boom");
    (err as Error & { code?: string }).code = "upstream_error";
    submitSam31Video.mockRejectedValueOnce(err);
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/v.mp4" }) as never,
    );
    expect(res.status).toBe(502);
  });
});

describe("POST /api/fal/sam-3-1-video/status (poll)", () => {
  it("returns pending while tracking", async () => {
    getSam31VideoResult.mockResolvedValueOnce({ status: "pending" });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/sam-3-1/video",
        requestId: "r1",
      }) as never,
    );
    expect((await res.json()).status).toBe("pending");
  });

  it("returns done with the mask video URL when complete", async () => {
    getSam31VideoResult.mockResolvedValueOnce({
      status: "done",
      videoUrl: "https://fal/mask.mp4",
      mime: "video/mp4",
      model: "fal-ai/sam-3-1/video",
    });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/sam-3-1/video",
        requestId: "r1",
      }) as never,
    );
    const body = await res.json();
    expect(body.videoUrl).toBe("https://fal/mask.mp4");
    expect(body.model).toBe("fal-ai/sam-3-1/video");
  });
});
