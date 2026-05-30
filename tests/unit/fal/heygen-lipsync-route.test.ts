import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitHeygenLipsync, getHeygenLipsyncResult } = vi.hoisted(() => ({
  submitHeygenLipsync: vi.fn(),
  getHeygenLipsyncResult: vi.fn(),
}));
vi.mock("@/lib/fal/heygen-lipsync-api", () => ({
  submitHeygenLipsync,
  getHeygenLipsyncResult,
}));

import { POST as SUBMIT } from "@/app/api/fal/heygen-lipsync/route";
import { POST as STATUS } from "@/app/api/fal/heygen-lipsync/status/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/fal/heygen-lipsync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  submitHeygenLipsync.mockReset();
  getHeygenLipsyncResult.mockReset();
});

describe("POST /api/fal/heygen-lipsync (submit)", () => {
  it("returns 400 on non-JSON", async () => {
    const res = await SUBMIT(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when videoUrl is missing", async () => {
    const res = await SUBMIT(
      makeRequest({ audioUrl: "https://x/a.mp3" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when audioUrl is missing", async () => {
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/v.mp4" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a partial-lipsync window with only one bound set", async () => {
    const res = await SUBMIT(
      makeRequest({
        videoUrl: "https://x/v.mp4",
        audioUrl: "https://x/a.mp3",
        startTime: 1,
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a window where end <= start", async () => {
    const res = await SUBMIT(
      makeRequest({
        videoUrl: "https://x/v.mp4",
        audioUrl: "https://x/a.mp3",
        startTime: 2,
        endTime: 2,
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("submits a valid request and returns the request id + endpoint", async () => {
    submitHeygenLipsync.mockResolvedValueOnce({
      requestId: "req-heygen-1",
      endpoint: "fal-ai/heygen/v3/lipsync/precision",
    });
    const res = await SUBMIT(
      makeRequest({
        videoUrl: "https://x/v.mp4",
        audioUrl: "https://x/a.mp3",
        enableDynamicDuration: false,
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe("req-heygen-1");
    expect(submitHeygenLipsync).toHaveBeenCalledTimes(1);
  });

  it("maps missing_key to 500", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    submitHeygenLipsync.mockRejectedValueOnce(err);
    const res = await SUBMIT(
      makeRequest({
        videoUrl: "https://x/v.mp4",
        audioUrl: "https://x/a.mp3",
      }) as never,
    );
    expect(res.status).toBe(500);
  });
});

describe("POST /api/fal/heygen-lipsync/status (poll)", () => {
  it("returns pending while rendering", async () => {
    getHeygenLipsyncResult.mockResolvedValueOnce({ status: "pending" });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/heygen/v3/lipsync/precision",
        requestId: "r1",
      }) as never,
    );
    expect((await res.json()).status).toBe("pending");
  });

  it("returns done with the dubbed video URL when complete", async () => {
    getHeygenLipsyncResult.mockResolvedValueOnce({
      status: "done",
      videoUrl: "https://fal/dubbed.mp4",
      captionUrl: "https://fal/captions.vtt",
      mime: "video/mp4",
      model: "fal-ai/heygen/v3/lipsync/precision",
    });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/heygen/v3/lipsync/precision",
        requestId: "r1",
      }) as never,
    );
    const body = await res.json();
    expect(body.videoUrl).toBe("https://fal/dubbed.mp4");
    expect(body.captionUrl).toBe("https://fal/captions.vtt");
  });
});
