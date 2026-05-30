import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitHunyuan3d, getHunyuan3dResult } = vi.hoisted(() => ({
  submitHunyuan3d: vi.fn(),
  getHunyuan3dResult: vi.fn(),
}));
vi.mock("@/lib/fal/hunyuan-3d-api", () => ({
  submitHunyuan3d,
  getHunyuan3dResult,
}));

import { POST as SUBMIT } from "@/app/api/fal/hunyuan-3d/route";
import { POST as STATUS } from "@/app/api/fal/hunyuan-3d/status/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/fal/hunyuan-3d", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  submitHunyuan3d.mockReset();
  getHunyuan3dResult.mockReset();
});

describe("POST /api/fal/hunyuan-3d (submit)", () => {
  it("returns 400 on non-JSON", async () => {
    const res = await SUBMIT(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("returns 400 when inputImageUrl is missing", async () => {
    const res = await SUBMIT(makeRequest({}) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when faceCount is below the minimum", async () => {
    const res = await SUBMIT(
      makeRequest({
        inputImageUrl: "https://x/front.png",
        faceCount: 1_000,
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("submits a valid request and returns the request id + endpoint", async () => {
    submitHunyuan3d.mockResolvedValueOnce({
      requestId: "req-3d-1",
      endpoint: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
    });
    const res = await SUBMIT(
      makeRequest({
        inputImageUrl: "https://x/front.png",
        generateType: "Normal",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe("req-3d-1");
    expect(submitHunyuan3d).toHaveBeenCalledTimes(1);
  });

  it("maps missing_key to 500", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    submitHunyuan3d.mockRejectedValueOnce(err);
    const res = await SUBMIT(
      makeRequest({ inputImageUrl: "https://x/front.png" }) as never,
    );
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("missing_key");
  });
});

describe("POST /api/fal/hunyuan-3d/status (poll)", () => {
  it("returns pending while rendering", async () => {
    getHunyuan3dResult.mockResolvedValueOnce({ status: "pending" });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
        requestId: "r1",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending");
  });

  it("returns done with the GLB url when complete", async () => {
    getHunyuan3dResult.mockResolvedValueOnce({
      status: "done",
      glbUrl: "https://fal/model.glb",
      objUrl: "https://fal/model.obj",
      thumbnailUrl: "https://fal/thumb.png",
      sizeBytes: 38554640,
      seed: 7,
      model: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
    });
    const res = await STATUS(
      makeRequest({
        endpoint: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
        requestId: "r1",
      }) as never,
    );
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.glbUrl).toBe("https://fal/model.glb");
    expect(body.objUrl).toBe("https://fal/model.obj");
    expect(body.thumbnailUrl).toBe("https://fal/thumb.png");
  });
});
