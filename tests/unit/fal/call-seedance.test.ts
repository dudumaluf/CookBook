import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callSeedanceVideo,
  FalCallError,
} from "@/lib/fal/call-seedance";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
function errResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("callSeedanceVideo", () => {
  it("posts the body and returns the success payload", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        videoUrl: "https://cdn.fal.media/clip.mp4",
        mime: "video/mp4",
        model: "bytedance/seedance-2.0/text-to-video",
      }),
    );
    const result = await callSeedanceVideo({
      prompt: "hello",
      signal: new AbortController().signal,
    });
    expect(result.videoUrl).toBe("https://cdn.fal.media/clip.mp4");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/fal/seedance",
      expect.objectContaining({ method: "POST" }),
    );
    // signal is stripped from the body.
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toEqual({ prompt: "hello" });
  });

  it("throws FalCallError on a non-2xx with the payload code", async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(502, { error: "Fal exploded", code: "upstream_error" }),
    );
    await expect(
      callSeedanceVideo({
        prompt: "x",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("rethrows a 499 as an AbortError", async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(499, { error: "cancelled", code: "aborted" }),
    );
    await expect(
      callSeedanceVideo({
        prompt: "x",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("wraps a network failure as FalCallError code='network'", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await expect(
      callSeedanceVideo({
        prompt: "x",
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(FalCallError);
  });
});
