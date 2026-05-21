import { beforeEach, describe, expect, it, vi } from "vitest";

const { listSoulStyles } = vi.hoisted(() => ({
  listSoulStyles: vi.fn(),
}));
vi.mock("@/lib/higgsfield/higgsfield-api", () => ({ listSoulStyles }));

import { GET } from "@/app/api/higgsfield/soul-styles/route";

function makeRequest(init?: { aborted?: boolean }): Request {
  const ctrl = new AbortController();
  if (init?.aborted) ctrl.abort();
  return new Request("http://localhost/api/higgsfield/soul-styles", {
    method: "GET",
    signal: ctrl.signal,
  });
}

beforeEach(() => {
  listSoulStyles.mockReset();
});

describe("GET /api/higgsfield/soul-styles", () => {
  it("returns 200 with the v2 style catalogue", async () => {
    listSoulStyles.mockResolvedValueOnce([
      {
        id: "95151de0-e0e5-4e04-bd45-c58c8a4ac023",
        name: "Street photography",
        description: "",
        previewUrl: "https://cdn.example/street.webp",
      },
      {
        id: "3d5584b2-4d15-48d2-8a09-c1073259f4c6",
        name: "Editorial street style",
        description: "",
        previewUrl: "https://cdn.example/editorial.webp",
      },
    ]);
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].name).toBe("Street photography");
    expect(listSoulStyles).toHaveBeenCalledTimes(1);
    expect(listSoulStyles.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
  });

  it("returns 200 with an empty array when the catalogue is empty", async () => {
    listSoulStyles.mockResolvedValueOnce([]);
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [] });
  });

  it("returns 499 when the wrapper throws AbortError", async () => {
    listSoulStyles.mockImplementationOnce(() => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(499);
    expect((await res.json()).code).toBe("aborted");
  });

  it("returns 500 + code='missing_keys' when env vars are absent", async () => {
    const err = new Error("HIGGSFIELD env vars missing");
    (err as Error & { code?: string }).code = "missing_keys";
    listSoulStyles.mockRejectedValueOnce(err);
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("missing_keys");
  });

  it("returns 502 + code='upstream_error' on non-2xx upstream", async () => {
    const err = new Error("Higgsfield 503");
    (err as Error & { code?: string }).code = "upstream_error";
    listSoulStyles.mockRejectedValueOnce(err);
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("upstream_error");
  });

  it("returns 500 + code='unknown' for unmapped errors with a generic message", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listSoulStyles.mockRejectedValueOnce(new Error("oops"));
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("unknown");
    expect(body.error).toBe("Failed to list Soul Styles");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
