import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitMarlin, getMarlinResult } = vi.hoisted(() => ({
  submitMarlin: vi.fn(),
  getMarlinResult: vi.fn(),
}));
vi.mock("@/lib/fal/marlin-api", () => ({ submitMarlin, getMarlinResult }));

import { POST as SUBMIT } from "@/app/api/fal/marlin/route";
import { POST as STATUS } from "@/app/api/fal/marlin/status/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/fal/marlin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  submitMarlin.mockReset();
  getMarlinResult.mockReset();
});

describe("POST /api/fal/marlin (submit)", () => {
  it("returns 400 on non-JSON", async () => {
    const res = await SUBMIT(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when videoUrl is missing", async () => {
    const res = await SUBMIT(makeRequest({}) as never);
    expect(res.status).toBe(400);
  });

  it("rejects an empty prompt override", async () => {
    const res = await SUBMIT(
      makeRequest({
        videoUrl: "https://x/clip.mp4",
        prompt: "",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("submits a valid request and returns the request id + endpoint", async () => {
    submitMarlin.mockResolvedValueOnce({
      requestId: "req-marlin-1",
      endpoint: "fal-ai/marlin",
    });
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/clip.mp4" }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe("req-marlin-1");
    expect(submitMarlin).toHaveBeenCalledTimes(1);
    // The route applied the canonical default prompt before calling.
    const passed = submitMarlin.mock.calls[0]![0] as { prompt: string };
    expect(passed.prompt).toMatch(/Provide a spatial description/);
  });

  it("maps missing_key to 500", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    submitMarlin.mockRejectedValueOnce(err);
    const res = await SUBMIT(
      makeRequest({ videoUrl: "https://x/clip.mp4" }) as never,
    );
    expect(res.status).toBe(500);
  });
});

describe("POST /api/fal/marlin/status (poll)", () => {
  it("returns pending while captioning", async () => {
    getMarlinResult.mockResolvedValueOnce({ status: "pending" });
    const res = await STATUS(
      makeRequest({ endpoint: "fal-ai/marlin", requestId: "r1" }) as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending");
  });

  it("returns done with scene + events + text when complete", async () => {
    getMarlinResult.mockResolvedValueOnce({
      status: "done",
      scene: "Indoor kitchen, daytime.",
      events: [
        { start: 0, end: 1.5, text: "a person waves" },
        { start: 1.5, end: 3, text: "they pick up a mug" },
      ],
      text: "Scene: Indoor kitchen…\nEvents: 0-1.5 a person waves",
      model: "fal-ai/marlin",
    });
    const res = await STATUS(
      makeRequest({ endpoint: "fal-ai/marlin", requestId: "r1" }) as never,
    );
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.scene).toMatch(/Indoor/);
    expect(body.events).toHaveLength(2);
    expect(body.text).toMatch(/Events/);
  });
});
