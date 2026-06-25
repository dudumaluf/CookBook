import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitDwpose, getDwposeResult } = vi.hoisted(() => ({
  submitDwpose: vi.fn(),
  getDwposeResult: vi.fn(),
}));
vi.mock("@/lib/fal/dwpose-api", () => ({ submitDwpose, getDwposeResult }));

import { POST as SUBMIT } from "@/app/api/fal/dwpose/route";
import { POST as STATUS } from "@/app/api/fal/dwpose/status/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/fal/dwpose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  submitDwpose.mockReset();
  getDwposeResult.mockReset();
});

describe("POST /api/fal/dwpose (submit)", () => {
  it("returns 400 on non-JSON", async () => {
    const res = await SUBMIT(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when videoUrl is missing", async () => {
    const res = await SUBMIT(makeRequest({ drawMode: "body-pose" }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when drawMode is not a known mode", async () => {
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/v.mp4", drawMode: "nope" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("accepts a request with no drawMode (Fal defaults to body-pose)", async () => {
    submitDwpose.mockResolvedValueOnce({
      requestId: "req-dw-1",
      endpoint: "fal-ai/dwpose/video",
    });
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/v.mp4" }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe("req-dw-1");
    expect(submitDwpose).toHaveBeenCalledTimes(1);
  });

  it("submits a valid request with a drawMode", async () => {
    submitDwpose.mockResolvedValueOnce({
      requestId: "req-dw-2",
      endpoint: "fal-ai/dwpose/video",
    });
    const res = await SUBMIT(
      makeRequest({
        videoUrl: "https://x/v.mp4",
        drawMode: "full-pose",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(submitDwpose).toHaveBeenCalledWith(
      expect.objectContaining({ videoUrl: "https://x/v.mp4", drawMode: "full-pose" }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("maps missing_key to 500", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    submitDwpose.mockRejectedValueOnce(err);
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/v.mp4" }) as never,
    );
    expect(res.status).toBe(500);
  });
});

describe("POST /api/fal/dwpose/status (poll)", () => {
  it("returns pending while estimating", async () => {
    getDwposeResult.mockResolvedValueOnce({ status: "pending" });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/dwpose/video",
        requestId: "r1",
      }) as never,
    );
    expect((await res.json()).status).toBe("pending");
  });

  it("returns done with the pose video URL when complete", async () => {
    getDwposeResult.mockResolvedValueOnce({
      status: "done",
      videoUrl: "https://fal/pose.mp4",
      mime: "video/mp4",
      model: "fal-ai/dwpose/video",
    });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/dwpose/video",
        requestId: "r1",
      }) as never,
    );
    const body = await res.json();
    expect(body.videoUrl).toBe("https://fal/pose.mp4");
    expect(body.model).toBe("fal-ai/dwpose/video");
  });
});
