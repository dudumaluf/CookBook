import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitVeedSubtitles, getVeedSubtitlesResult } = vi.hoisted(() => ({
  submitVeedSubtitles: vi.fn(),
  getVeedSubtitlesResult: vi.fn(),
}));
vi.mock("@/lib/fal/veed-subtitles-api", () => ({
  submitVeedSubtitles,
  getVeedSubtitlesResult,
}));

import { POST as SUBMIT } from "@/app/api/fal/veed-subtitles/route";
import { POST as STATUS } from "@/app/api/fal/veed-subtitles/status/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/fal/veed-subtitles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  submitVeedSubtitles.mockReset();
  getVeedSubtitlesResult.mockReset();
});

describe("POST /api/fal/veed-subtitles (submit)", () => {
  it("returns 400 on non-JSON", async () => {
    const res = await SUBMIT(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when videoUrl is missing", async () => {
    const res = await SUBMIT(makeRequest({ preset: "simple" }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when preset is missing", async () => {
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/v.mp4" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when preset is not a known style", async () => {
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/v.mp4", preset: "nope" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("submits a valid request and returns the request id + endpoint", async () => {
    submitVeedSubtitles.mockResolvedValueOnce({
      requestId: "req-veed-1",
      endpoint: "veed/subtitles",
    });
    const res = await SUBMIT(
      makeRequest({
        videoUrl: "https://x/v.mp4",
        preset: "simple",
        translationLanguage: "es-ES",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe("req-veed-1");
    expect(submitVeedSubtitles).toHaveBeenCalledTimes(1);
  });

  it("maps missing_key to 500", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    submitVeedSubtitles.mockRejectedValueOnce(err);
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/v.mp4", preset: "simple" }) as never,
    );
    expect(res.status).toBe(500);
  });
});

describe("POST /api/fal/veed-subtitles/status (poll)", () => {
  it("returns pending while rendering", async () => {
    getVeedSubtitlesResult.mockResolvedValueOnce({ status: "pending" });
    const res = await STATUS(
      makeRequest({
        endpoint: "veed/subtitles",
        requestId: "r1",
      }) as never,
    );
    expect((await res.json()).status).toBe("pending");
  });

  it("returns done with the subtitled video URL when complete", async () => {
    getVeedSubtitlesResult.mockResolvedValueOnce({
      status: "done",
      videoUrl: "https://fal/subbed.mp4",
      mime: "video/mp4",
      model: "veed/subtitles",
    });
    const res = await STATUS(
      makeRequest({
        endpoint: "veed/subtitles",
        requestId: "r1",
      }) as never,
    );
    const body = await res.json();
    expect(body.videoUrl).toBe("https://fal/subbed.mp4");
    expect(body.model).toBe("veed/subtitles");
  });
});
