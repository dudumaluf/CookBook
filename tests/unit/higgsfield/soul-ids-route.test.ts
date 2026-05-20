import { beforeEach, describe, expect, it, vi } from "vitest";

const { listSoulIds } = vi.hoisted(() => ({
  listSoulIds: vi.fn(),
}));
vi.mock("@/lib/higgsfield/higgsfield-api", () => ({ listSoulIds }));

import { GET } from "@/app/api/higgsfield/soul-ids/route";

function makeRequest(init?: { aborted?: boolean }): Request {
  const ctrl = new AbortController();
  if (init?.aborted) ctrl.abort();
  return new Request("http://localhost/api/higgsfield/soul-ids", {
    method: "GET",
    signal: ctrl.signal,
  });
}

beforeEach(() => {
  listSoulIds.mockReset();
});

describe("GET /api/higgsfield/soul-ids", () => {
  it("returns 200 with the list of Soul IDs from the wrapper", async () => {
    listSoulIds.mockResolvedValueOnce([
      {
        id: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
        name: "Me v2",
        modelVersion: "v2",
        status: "completed",
        thumbnailUrl: "https://cdn.example/me.jpg",
        createdAt: "2026-04-01T12:00:00Z",
      },
    ]);

    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Me v2");
    expect(listSoulIds).toHaveBeenCalledTimes(1);
    expect(listSoulIds.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
  });

  it("returns 200 with an empty array when no Soul IDs exist", async () => {
    listSoulIds.mockResolvedValueOnce([]);
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [] });
  });

  it("returns 499 when the wrapper throws AbortError", async () => {
    listSoulIds.mockImplementationOnce(() => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(499);
    const body = await res.json();
    expect(body.code).toBe("aborted");
  });

  it("returns 500 + code='missing_keys' when env vars are absent", async () => {
    const err = new Error("HIGGSFIELD env vars missing");
    (err as Error & { code?: string }).code = "missing_keys";
    listSoulIds.mockRejectedValueOnce(err);

    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("missing_keys");
  });

  it("returns 502 + code='upstream_error' on non-2xx upstream", async () => {
    const err = new Error("Higgsfield 503");
    (err as Error & { code?: string }).code = "upstream_error";
    listSoulIds.mockRejectedValueOnce(err);

    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("upstream_error");
  });

  it("returns 500 + code='unknown' for unmapped errors with a generic message", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    listSoulIds.mockRejectedValueOnce(new Error("oops"));

    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("unknown");
    expect(body.error).toBe("Failed to list Soul IDs");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
