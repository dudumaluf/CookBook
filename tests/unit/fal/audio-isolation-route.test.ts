import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitAudioIsolation, getAudioIsolationResult } = vi.hoisted(() => ({
  submitAudioIsolation: vi.fn(),
  getAudioIsolationResult: vi.fn(),
}));
vi.mock("@/lib/fal/audio-isolation-api", () => ({
  submitAudioIsolation,
  getAudioIsolationResult,
}));

import { POST as SUBMIT } from "@/app/api/fal/audio-isolation/route";
import { POST as STATUS } from "@/app/api/fal/audio-isolation/status/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/fal/audio-isolation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  submitAudioIsolation.mockReset();
  getAudioIsolationResult.mockReset();
});

describe("POST /api/fal/audio-isolation (submit)", () => {
  it("returns 400 on non-JSON", async () => {
    const res = await SUBMIT(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("returns 400 when neither audio nor video url is provided", async () => {
    const res = await SUBMIT(makeRequest({}) as never);
    expect(res.status).toBe(400);
  });

  it("submits with audioUrl and returns request id", async () => {
    submitAudioIsolation.mockResolvedValueOnce({
      requestId: "req-a1",
      endpoint: "fal-ai/elevenlabs/audio-isolation",
    });
    const res = await SUBMIT(
      makeRequest({
        audioUrl: "https://x/song.mp3",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe("req-a1");
    expect(submitAudioIsolation).toHaveBeenCalledTimes(1);
  });

  it("maps missing_key to 500", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    submitAudioIsolation.mockRejectedValueOnce(err);
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/clip.mp4" }) as never,
    );
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("missing_key");
  });
});

describe("POST /api/fal/audio-isolation/status (poll)", () => {
  it("returns pending while processing", async () => {
    getAudioIsolationResult.mockResolvedValueOnce({ status: "pending" });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/elevenlabs/audio-isolation",
        requestId: "r1",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending");
  });

  it("returns done with audioUrl when complete", async () => {
    getAudioIsolationResult.mockResolvedValueOnce({
      status: "done",
      audioUrl: "https://fal/isolated.mp3",
      model: "fal-ai/elevenlabs/audio-isolation",
    });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/elevenlabs/audio-isolation",
        requestId: "r1",
      }) as never,
    );
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.audioUrl).toBe("https://fal/isolated.mp3");
  });
});
