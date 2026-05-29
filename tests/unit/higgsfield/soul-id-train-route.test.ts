import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSoulId } = vi.hoisted(() => ({ createSoulId: vi.fn() }));
vi.mock("@/lib/higgsfield/higgsfield-api", () => ({ createSoulId }));

import { POST } from "@/app/api/higgsfield/soul-id/train/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/higgsfield/soul-id/train", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: new AbortController().signal,
  });
}

beforeEach(() => {
  createSoulId.mockReset();
});

describe("POST /api/higgsfield/soul-id/train", () => {
  it("400 on non-JSON body", async () => {
    const res = await POST(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
    expect(createSoulId).not.toHaveBeenCalled();
  });

  it("400 when name is missing", async () => {
    const res = await POST(
      makeRequest({ imageUrls: ["https://x/a.png"] }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("400 when no image urls", async () => {
    const res = await POST(makeRequest({ name: "Dudu", imageUrls: [] }) as never);
    expect(res.status).toBe(400);
  });

  it("forwards a valid request and returns the record", async () => {
    createSoulId.mockResolvedValueOnce({
      id: "char-1",
      name: "Dudu",
      modelVersion: "v2",
      status: "queued",
      thumbnailUrl: null,
      createdAt: "2026-05-28",
    });
    const res = await POST(
      makeRequest({
        name: "Dudu",
        variant: "v2",
        imageUrls: ["https://x/a.png", "https://x/b.png"],
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record.id).toBe("char-1");
    const [args, signal] = createSoulId.mock.calls[0]!;
    expect(args).toMatchObject({
      name: "Dudu",
      variant: "v2",
      imageUrls: ["https://x/a.png", "https://x/b.png"],
    });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("429 on concurrent_limit", async () => {
    const err = new Error("Maximum number of concurrent requests (4)");
    (err as Error & { code?: string }).code = "concurrent_limit";
    createSoulId.mockRejectedValueOnce(err);
    const res = await POST(
      makeRequest({ name: "X", imageUrls: ["https://x/a.png"] }) as never,
    );
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("concurrent_limit");
  });

  it("502 on upstream_error", async () => {
    const err = new Error("HTTP 500");
    (err as Error & { code?: string }).code = "upstream_error";
    createSoulId.mockRejectedValueOnce(err);
    const res = await POST(
      makeRequest({ name: "X", imageUrls: ["https://x/a.png"] }) as never,
    );
    expect(res.status).toBe(502);
  });
});
