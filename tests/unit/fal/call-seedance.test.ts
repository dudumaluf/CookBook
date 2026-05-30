import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callSeedanceVideo, FalCallError } from "@/lib/fal/call-seedance";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
function errResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const SUBMIT = { requestId: "req-1", endpoint: "bytedance/seedance-2.0/text-to-video" };

/** Drive the poll loop forward a few intervals, flushing awaits each tick. */
async function tick(times = 4) {
  for (let i = 0; i < times; i++) await vi.advanceTimersByTimeAsync(3_000);
}

describe("callSeedanceVideo (submit + poll)", () => {
  it("submits then polls until done, returning the video", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(SUBMIT)) // submit
      .mockResolvedValueOnce(ok({ status: "pending" })) // poll 1
      .mockResolvedValueOnce(
        ok({
          status: "done",
          videoUrl: "https://cdn.fal.media/clip.mp4",
          mime: "video/mp4",
          model: SUBMIT.endpoint,
        }),
      ); // poll 2

    const p = callSeedanceVideo({ prompt: "hello", signal: new AbortController().signal });
    await tick();
    const result = await p;

    expect(result.videoUrl).toBe("https://cdn.fal.media/clip.mp4");
    // First call submits to the base route with the body (no signal field).
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/fal/seedance");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ prompt: "hello" });
    // Subsequent calls poll the status route with the requestId + endpoint.
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/fal/seedance/status");
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
      endpoint: SUBMIT.endpoint,
      requestId: SUBMIT.requestId,
    });
  });

  it("tolerates a transient poll network blip and still resolves", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(SUBMIT)) // submit
      .mockRejectedValueOnce(new TypeError("failed to fetch")) // poll 1 — blip
      .mockResolvedValueOnce(
        ok({ status: "done", videoUrl: "https://cdn/x.mp4", model: SUBMIT.endpoint }),
      ); // poll 2 — recovered

    const p = callSeedanceVideo({ prompt: "x", signal: new AbortController().signal });
    await tick();
    await expect(p).resolves.toMatchObject({ videoUrl: "https://cdn/x.mp4" });
  });

  it("surfaces an upstream job failure during polling", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(SUBMIT))
      .mockResolvedValueOnce(
        errResponse(502, { error: "Fal exploded", code: "upstream_error" }),
      );
    const p = callSeedanceVideo({ prompt: "x", signal: new AbortController().signal });
    // Attach the rejection handler BEFORE advancing timers so the rejection
    // (which fires mid-tick) is never momentarily unhandled.
    const assertion = expect(p).rejects.toMatchObject({ code: "upstream_error" });
    await tick();
    await assertion;
  });

  it("wraps a submit network failure as FalCallError code='network'", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    const p = callSeedanceVideo({ prompt: "x", signal: new AbortController().signal });
    await expect(p).rejects.toBeInstanceOf(FalCallError);
    await expect(p).rejects.toMatchObject({ code: "network" });
  });

  it("rethrows a 499 submit as an AbortError", async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(499, { error: "cancelled", code: "aborted" }),
    );
    const p = callSeedanceVideo({ prompt: "x", signal: new AbortController().signal });
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});
