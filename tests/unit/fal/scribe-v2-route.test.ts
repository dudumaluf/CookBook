import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitScribeV2, getScribeV2Result } = vi.hoisted(() => ({
  submitScribeV2: vi.fn(),
  getScribeV2Result: vi.fn(),
}));
vi.mock("@/lib/fal/scribe-v2-api", () => ({
  submitScribeV2,
  getScribeV2Result,
}));

import { POST as SUBMIT } from "@/app/api/fal/scribe-v2/route";
import { POST as STATUS } from "@/app/api/fal/scribe-v2/status/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/fal/scribe-v2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  submitScribeV2.mockReset();
  getScribeV2Result.mockReset();
});

describe("POST /api/fal/scribe-v2 (submit)", () => {
  it("returns 400 on non-JSON", async () => {
    const res = await SUBMIT(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("returns 400 when audioUrl is missing", async () => {
    const res = await SUBMIT(makeRequest({}) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("returns 400 when audioUrl is not a URL", async () => {
    const res = await SUBMIT(
      makeRequest({ audioUrl: "not-a-url" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when keyterms exceed length cap", async () => {
    const res = await SUBMIT(
      makeRequest({
        audioUrl: "https://x/clip.mp3",
        keyterms: ["x".repeat(51)],
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("submits with audioUrl and returns request id", async () => {
    submitScribeV2.mockResolvedValueOnce({
      requestId: "req-s1",
      endpoint: "fal-ai/elevenlabs/speech-to-text/scribe-v2",
    });
    const res = await SUBMIT(
      makeRequest({
        audioUrl: "https://x/clip.mp3",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe("req-s1");
    expect(submitScribeV2).toHaveBeenCalledTimes(1);
    expect(submitScribeV2).toHaveBeenCalledWith(
      expect.objectContaining({ audioUrl: "https://x/clip.mp3" }),
      expect.anything(),
    );
  });

  it("forwards optional knobs (languageCode, diarize, keyterms)", async () => {
    submitScribeV2.mockResolvedValueOnce({
      requestId: "req-s2",
      endpoint: "fal-ai/elevenlabs/speech-to-text/scribe-v2",
    });
    await SUBMIT(
      makeRequest({
        audioUrl: "https://x/clip.mp3",
        languageCode: "eng",
        tagAudioEvents: false,
        diarize: false,
        keyterms: ["fal", "elevenlabs"],
      }) as never,
    );
    expect(submitScribeV2).toHaveBeenCalledWith(
      expect.objectContaining({
        audioUrl: "https://x/clip.mp3",
        languageCode: "eng",
        tagAudioEvents: false,
        diarize: false,
        keyterms: ["fal", "elevenlabs"],
      }),
      expect.anything(),
    );
  });

  it("maps missing_key to 500", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    submitScribeV2.mockRejectedValueOnce(err);
    const res = await SUBMIT(
      makeRequest({ audioUrl: "https://x/clip.mp3" }) as never,
    );
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("missing_key");
  });

  it("maps upstream_error to 502", async () => {
    const err = new Error("Fal: boom");
    (err as Error & { code?: string }).code = "upstream_error";
    submitScribeV2.mockRejectedValueOnce(err);
    const res = await SUBMIT(
      makeRequest({ audioUrl: "https://x/clip.mp3" }) as never,
    );
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("upstream_error");
  });
});

describe("POST /api/fal/scribe-v2/status (poll)", () => {
  it("returns pending while processing", async () => {
    getScribeV2Result.mockResolvedValueOnce({ status: "pending" });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/elevenlabs/speech-to-text/scribe-v2",
        requestId: "r1",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending");
  });

  it("returns done with text + words when complete", async () => {
    getScribeV2Result.mockResolvedValueOnce({
      status: "done",
      text: "Hello world.",
      languageCode: "eng",
      languageProbability: 0.99,
      words: [
        {
          start: 0,
          end: 0.5,
          text: "Hello",
          type: "word",
          speakerId: "speaker_0",
        },
      ],
      model: "fal-ai/elevenlabs/speech-to-text/scribe-v2",
    });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/elevenlabs/speech-to-text/scribe-v2",
        requestId: "r1",
      }) as never,
    );
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.text).toBe("Hello world.");
    expect(body.languageCode).toBe("eng");
    expect(body.words).toHaveLength(1);
    expect(body.words[0].speakerId).toBe("speaker_0");
  });

  it("rejects status payload missing requestId", async () => {
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/elevenlabs/speech-to-text/scribe-v2",
      }) as never,
    );
    expect(res.status).toBe(400);
  });
});
