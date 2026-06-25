import { beforeEach, describe, expect, it, vi } from "vitest";

const { restyleTelestyleV2 } = vi.hoisted(() => ({
  restyleTelestyleV2: vi.fn(),
}));
vi.mock("@/lib/fal/telestyle-v2-api", () => ({ restyleTelestyleV2 }));

import { POST } from "@/app/api/fal/telestyle-v2/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/fal/telestyle-v2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  restyleTelestyleV2.mockReset();
});

describe("POST /api/fal/telestyle-v2", () => {
  it("returns 400 on non-JSON", async () => {
    const res = await POST(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when contentImageUrl is missing", async () => {
    const res = await POST(
      makeRequest({ styleImageUrl: "https://x/s.png" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when styleImageUrl is missing", async () => {
    const res = await POST(
      makeRequest({ contentImageUrl: "https://x/c.png" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when loraScale is out of range", async () => {
    const res = await POST(
      makeRequest({
        contentImageUrl: "https://x/c.png",
        styleImageUrl: "https://x/s.png",
        loraScale: 9,
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("restyles a valid request and returns the stylized image", async () => {
    restyleTelestyleV2.mockResolvedValueOnce({
      imageUrl: "https://fal/styled.png",
      mime: "image/png",
      prompt: "a watercolor portrait",
      seed: 42,
      model: "fal-ai/telestyle-v2",
    });
    const res = await POST(
      makeRequest({
        contentImageUrl: "https://x/c.png",
        styleImageUrl: "https://x/s.png",
        loraScale: 0.8,
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imageUrl).toBe("https://fal/styled.png");
    expect(body.model).toBe("fal-ai/telestyle-v2");
    expect(restyleTelestyleV2).toHaveBeenCalledWith(
      expect.objectContaining({
        contentImageUrl: "https://x/c.png",
        styleImageUrl: "https://x/s.png",
        loraScale: 0.8,
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("maps missing_key to 500", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    restyleTelestyleV2.mockRejectedValueOnce(err);
    const res = await POST(
      makeRequest({
        contentImageUrl: "https://x/c.png",
        styleImageUrl: "https://x/s.png",
      }) as never,
    );
    expect(res.status).toBe(500);
  });

  it("maps upstream_error to 502", async () => {
    const err = new Error("Fal: boom");
    (err as Error & { code?: string }).code = "upstream_error";
    restyleTelestyleV2.mockRejectedValueOnce(err);
    const res = await POST(
      makeRequest({
        contentImageUrl: "https://x/c.png",
        styleImageUrl: "https://x/s.png",
      }) as never,
    );
    expect(res.status).toBe(502);
  });
});
