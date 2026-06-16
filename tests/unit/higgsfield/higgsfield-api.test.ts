import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  higgsfieldImageRequestSchema,
  type HiggsfieldImageRequest,
  type HiggsfieldSoulIdSummary,
} from "@/lib/higgsfield/types";

/**
 * Server wrapper unit tests. The wrapper has these responsibilities to lock in:
 *   1. Friendly `missing_keys` error when env vars are absent.
 *   2. Auth header shape (`Authorization: Key KEY:SECRET`).
 *   3. Submit → poll → completed loop with `images` extracted.
 *   4. NSFW + failed terminal states surfaced with distinct error codes.
 *   5. Mode-aware body building (reference vs style vs none).
 *   6. AbortSignal honoured during both submit and poll wait.
 *   7. Soul ID list pagination.
 *
 * Stub `server-only` — Node test env doesn't need it (and the Vitest config
 * already aliases the package, but `vi.mock` is more explicit per-test).
 */

vi.mock("server-only", () => ({}));

const SOUL_ID_UUID = "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e";

const realFetch = globalThis.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  delete process.env.HIGGSFIELD_API_KEY;
  delete process.env.HIGGSFIELD_API_SECRET;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.HIGGSFIELD_API_KEY;
  delete process.env.HIGGSFIELD_API_SECRET;
});

/** Minimal Response-like object that the wrapper's fetchJson can read. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* --------------------------- generateSoulImage --------------------------- */

describe("generateSoulImage", () => {
  function setEnv() {
    process.env.HIGGSFIELD_API_KEY = "key";
    process.env.HIGGSFIELD_API_SECRET = "secret";
  }

  function defaultRequest(
    overrides: Partial<HiggsfieldImageRequest> = {},
  ): HiggsfieldImageRequest {
    return {
      prompt: "soft window light, editorial",
      mode: "none",
      variant: "none",
      ...overrides,
    } as HiggsfieldImageRequest;
  }

  it("throws code='missing_keys' when env vars are absent", async () => {
    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      generateSoulImage(defaultRequest(), new AbortController().signal),
    ).rejects.toMatchObject({
      message: /HIGGSFIELD_API_KEY/,
      code: "missing_keys",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the soul/v2/standard endpoint with the docs auth header", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-1",
        status_url: "irrelevant",
        cancel_url: "irrelevant",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-1",
        images: [{ url: "https://cdn.example/a.png" }],
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const result = await generateSoulImage(
      defaultRequest({ prompt: "hi" }),
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    expect(result).toEqual({
      imageUrls: ["https://cdn.example/a.png"],
      requestId: "req-1",
      model: "higgsfield-ai/soul/v2/standard",
    });

    const [submitUrl, submitInit] = fetchMock.mock.calls[0]!;
    expect(submitUrl).toBe(
      "https://platform.higgsfield.ai/higgsfield-ai/soul/v2/standard",
    );
    const headers = submitInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Key key:secret");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("polls until status === 'completed' and extracts every image url", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-2",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: "queued", request_id: "req-2" }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: "in_progress", request_id: "req-2" }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-2",
        images: [
          { url: "https://cdn.example/a.png" },
          { url: "https://cdn.example/b.png" },
          { url: "https://cdn.example/c.png" },
          { url: "https://cdn.example/d.png" },
        ],
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const result = await generateSoulImage(
      defaultRequest({ batchSize: 4 }),
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    expect(result.imageUrls).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // First call is the submit; the rest are polls.
    expect(fetchMock.mock.calls[1]![0]).toContain("/requests/req-2/status");
  });

  it("throws code='nsfw' on terminal NSFW status (no charge)", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-3",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: "nsfw", request_id: "req-3" }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      generateSoulImage(defaultRequest(), new AbortController().signal, {
        pollIntervalMs: 1,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: "nsfw" });
  });

  it("throws code='upstream_failed' on terminal failed status", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-4",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "failed",
        request_id: "req-4",
        message: "internal error",
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      generateSoulImage(defaultRequest(), new AbortController().signal, {
        pollIntervalMs: 1,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: "upstream_failed" });
  });

  it("throws code='upstream_error' when the submit returns a non-2xx", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { detail: "boom" }));

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      generateSoulImage(defaultRequest(), new AbortController().signal, {
        pollIntervalMs: 1,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("throws code='concurrent_limit' on Higgsfield's 4-concurrent cap message", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        detail: "Maximum number of concurrent requests (4) has been reached",
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      generateSoulImage(defaultRequest(), new AbortController().signal, {
        pollIntervalMs: 1,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: "concurrent_limit" });
  });

  it("surfaces FastAPI body-validation errors with their `msg` field (not the JSON blob)", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        detail: [
          {
            type: "missing",
            loc: ["body", "prompt"],
            msg: "Field required",
            input: {},
          },
        ],
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      generateSoulImage(defaultRequest(), new AbortController().signal, {
        pollIntervalMs: 1,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({
      code: "upstream_error",
      message: /Field required/,
    });
  });

  it("throws code='timeout' when the poll budget is exhausted", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-5",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    // Every subsequent poll returns a FRESH Response — Response bodies
    // are single-use, so reusing one instance crashes after the first
    // call with "Body has already been used".
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(200, { status: "queued", request_id: "req-5" }),
      ),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      generateSoulImage(defaultRequest(), new AbortController().signal, {
        pollIntervalMs: 1,
        timeoutMs: 50, // tiny so the test runs fast
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects immediately when the signal is already aborted", async () => {
    setEnv();
    const ctrl = new AbortController();
    ctrl.abort();

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      generateSoulImage(defaultRequest(), ctrl.signal, {
        pollIntervalMs: 1,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts during the poll wait when the signal trips mid-flight", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-6",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: "queued", request_id: "req-6" }),
    );

    const ctrl = new AbortController();
    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const promise = generateSoulImage(defaultRequest(), ctrl.signal, {
      pollIntervalMs: 200,
      timeoutMs: 5_000,
    });
    // Abort during the sleep between polls.
    setTimeout(() => ctrl.abort(), 30);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends `image_url` in reference mode and never sends `style_id`", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-7",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-7",
        images: [{ url: "https://cdn.example/r.png" }],
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await generateSoulImage(
      {
        prompt: "go",
        mode: "reference",
        variant: "v2",
        referenceUrl: "https://example.com/me.jpg",
        soulId: SOUL_ID_UUID,
      },
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    const submitInit = fetchMock.mock.calls[0]![1]!;
    const body = JSON.parse(submitInit.body as string);
    expect(body.image_url).toBe("https://example.com/me.jpg");
    expect(body.style_id).toBeUndefined();
    // Soul ID lands as Higgsfield's `custom_reference_id` (not `soul_id`).
    expect(body.custom_reference_id).toBe(SOUL_ID_UUID);
    expect(body.soul_id).toBeUndefined();
  });

  it("sends `style_id` in style mode and never sends `image_url`", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-8",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-8",
        images: [{ url: "https://cdn.example/s.png" }],
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await generateSoulImage(
      {
        prompt: "go",
        mode: "style",
        variant: "v2",
        styleId: "b1c2d3e4-5f6a-4789-90bc-1d2e3f405162",
      },
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    const submitInit = fetchMock.mock.calls[0]![1]!;
    const body = JSON.parse(submitInit.body as string);
    expect(body.style_id).toBe("b1c2d3e4-5f6a-4789-90bc-1d2e3f405162");
    expect(body.image_url).toBeUndefined();
  });

  it("dispatches to /soul/v2/standard when variant='v2'", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-v2",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-v2",
        images: [{ url: "https://cdn.example/v2.png" }],
      }),
    );
    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const result = await generateSoulImage(
      defaultRequest({ variant: "v2" }),
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );
    expect(fetchMock.mock.calls[0]![0]).toContain("/soul/v2/standard");
    expect(result.model).toBe("higgsfield-ai/soul/v2/standard");
  });

  it("dispatches to /soul/cinema when variant='cinema' and drops styleId silently", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-c",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-c",
        images: [{ url: "https://cdn.example/c.png" }],
      }),
    );
    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const result = await generateSoulImage(
      {
        prompt: "go",
        variant: "cinema",
        mode: "style",
        styleId: SOUL_ID_UUID, // would 400 on cinema; wrapper drops it
      },
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );
    expect(fetchMock.mock.calls[0]![0]).toContain("/soul/cinema");
    expect(result.model).toBe("higgsfield-ai/soul/cinema");
    const body = JSON.parse(
      fetchMock.mock.calls[0]![1]!.body as string,
    );
    expect(body.style_id).toBeUndefined();
  });

  it("dispatches to /soul/character when variant='v1'", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-1",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-1",
        images: [{ url: "https://cdn.example/1.png" }],
      }),
    );
    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const result = await generateSoulImage(
      defaultRequest({ variant: "v1" }),
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );
    expect(fetchMock.mock.calls[0]![0]).toContain("/soul/character");
    expect(result.model).toBe("higgsfield-ai/soul/character");
  });

  it("forwards seed + negative prompt + aspect/resolution/batchSize", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-9",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-9",
        images: [{ url: "https://cdn.example/x.png" }],
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await generateSoulImage(
      {
        prompt: "go",
        mode: "none",
        variant: "none",
        aspectRatio: "9:16",
        resolution: "1080p",
        batchSize: 4,
        seed: 42,
        negativePrompt: "blur, low quality",
      },
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.aspect_ratio).toBe("9:16");
    expect(body.resolution).toBe("1080p");
    expect(body.batch_size).toBe(4);
    expect(body.seed).toBe(42);
    expect(body.negative_prompt).toBe("blur, low quality");
  });

  /* ─── post-5.6.2: undocumented strength fields (UI-parity defaults) ─── */

  it("always sends enhance_prompt: true by default (mode 'none', no soulId, no styleId)", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-eh1",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-eh1",
        images: [{ url: "https://cdn.example/x.png" }],
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await generateSoulImage(
      defaultRequest({ prompt: "minimal" }),
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.enhance_prompt).toBe(true);
    // Strength fields are absent when their owning fields aren't set.
    expect(body.style_strength).toBeUndefined();
    expect(body.custom_reference_strength).toBeUndefined();
  });

  it("sends style_strength: 1.0 by default when mode === 'style' and a styleId is provided", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-eh2",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-eh2",
        images: [{ url: "https://cdn.example/x.png" }],
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await generateSoulImage(
      {
        prompt: "man in the street",
        mode: "style",
        variant: "v2",
        styleId: "069f5a5f-8c4b-4591-a3dd-bde488672228", // Retro BW
      } as HiggsfieldImageRequest,
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.style_id).toBe("069f5a5f-8c4b-4591-a3dd-bde488672228");
    expect(body.style_strength).toBe(1.0);
    expect(body.enhance_prompt).toBe(true);
  });

  it("sends custom_reference_strength: 1.0 by default whenever soulId is set", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-eh3",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-eh3",
        images: [{ url: "https://cdn.example/x.png" }],
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await generateSoulImage(
      {
        prompt: "portrait",
        mode: "none",
        variant: "v2",
        soulId: SOUL_ID_UUID,
      } as HiggsfieldImageRequest,
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.custom_reference_id).toBe(SOUL_ID_UUID);
    expect(body.custom_reference_strength).toBe(1.0);
    expect(body.style_strength).toBeUndefined();
  });

  it("caller-provided strength + enhance_prompt overrides win over defaults", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-eh4",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-eh4",
        images: [{ url: "https://cdn.example/x.png" }],
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await generateSoulImage(
      {
        prompt: "portrait",
        mode: "style",
        variant: "v2",
        soulId: SOUL_ID_UUID,
        styleId: "069f5a5f-8c4b-4591-a3dd-bde488672228",
        enhancePrompt: false,
        styleStrength: 0.5,
        customReferenceStrength: 0.85,
      } as HiggsfieldImageRequest,
      new AbortController().signal,
      { pollIntervalMs: 1, timeoutMs: 5_000 },
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.enhance_prompt).toBe(false);
    expect(body.style_strength).toBe(0.5);
    expect(body.custom_reference_strength).toBe(0.85);
  });

  it("throws code='upstream_error' when 'completed' returns no image urls", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-10",
        status_url: "x",
        cancel_url: "x",
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-10",
        images: [{}], // no url field
      }),
    );

    const { generateSoulImage } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      generateSoulImage(defaultRequest(), new AbortController().signal, {
        pollIntervalMs: 1,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: "upstream_error" });
  });
});

/* --------------------- request schema (cinema 21:9) --------------------- */

describe("higgsfieldImageRequestSchema — cinema aspect ratios", () => {
  it("accepts a Soul Cinema request with the ultra-wide 21:9 ratio", () => {
    const parsed = higgsfieldImageRequestSchema.safeParse({
      prompt: "moody noir alley, anamorphic",
      variant: "cinema",
      mode: "none",
      aspectRatio: "21:9",
      resolution: "1080p",
      batchSize: 1,
      enhancePrompt: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("still accepts the standard Soul ratios", () => {
    for (const ar of ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]) {
      const parsed = higgsfieldImageRequestSchema.safeParse({
        prompt: "x",
        variant: "none",
        mode: "none",
        aspectRatio: ar,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects an unknown aspect ratio", () => {
    const parsed = higgsfieldImageRequestSchema.safeParse({
      prompt: "x",
      variant: "cinema",
      mode: "none",
      aspectRatio: "32:9",
    });
    expect(parsed.success).toBe(false);
  });
});

/* ------------------------------ listSoulIds ------------------------------ */

describe("listSoulIds", () => {
  function setEnv() {
    process.env.HIGGSFIELD_API_KEY = "key";
    process.env.HIGGSFIELD_API_SECRET = "secret";
  }

  function pageResponse(
    page: number,
    totalPages: number,
    items: HiggsfieldSoulIdSummary[],
  ): Response {
    return jsonResponse(200, {
      total: items.length * totalPages,
      page,
      page_size: 20,
      total_pages: totalPages,
      items: items.map((it) => ({
        id: it.id,
        name: it.name,
        model_version: it.modelVersion,
        status: it.status,
        thumbnail_url: it.thumbnailUrl,
        created_at: it.createdAt,
      })),
    });
  }

  it("normalises the snake_case API payload into camelCase", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      pageResponse(1, 1, [
        {
          id: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
          name: "Me",
          modelVersion: "v2",
          status: "completed",
          thumbnailUrl: "https://cdn.example/me.jpg",
          createdAt: "2026-04-01T12:00:00Z",
        },
      ]),
    );

    const { listSoulIds } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const items = await listSoulIds(new AbortController().signal);
    expect(items).toEqual([
      {
        id: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
        name: "Me",
        modelVersion: "v2",
        status: "completed",
        thumbnailUrl: "https://cdn.example/me.jpg",
        createdAt: "2026-04-01T12:00:00Z",
      },
    ]);
  });

  it("walks every page when total_pages > 1", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      pageResponse(1, 2, [
        {
          id: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
          name: "A",
          modelVersion: "v2",
          status: "completed",
          thumbnailUrl: null,
          createdAt: "2026-04-01T12:00:00Z",
        },
      ]),
    );
    // Page 1 has a completed v2 character → wrapper does an extra GET
    // for its thumbnail. Mock it with reference_media so we can assert
    // the thumbnail was filled in from the per-char endpoint.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        id: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
        name: "A",
        model_version: "v2",
        status: "completed",
        thumbnail_url: null,
        created_at: "2026-04-01T12:00:00Z",
        reference_media: [
          { id: "ref-1", media_url: "https://cdn.example/A-cover.jpg" },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      pageResponse(2, 2, [
        {
          id: "b1c2d3e4-5f6a-4789-90bc-1d2e3f405162",
          name: "B",
          modelVersion: "v1",
          status: "in_progress",
          thumbnailUrl: null,
          createdAt: "2026-04-02T12:00:00Z",
        },
      ]),
    );
    // No GET extra for "B" because it's in_progress, not completed.

    const { listSoulIds } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const items = await listSoulIds(new AbortController().signal);
    expect(items.map((i) => i.name)).toEqual(["A", "B"]);
    // page1 + GET-thumbnail-A + page2 = 3 fetches
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(items[0]!.thumbnailUrl).toBe("https://cdn.example/A-cover.jpg");
  });

  it("throws code='missing_keys' when env vars are absent", async () => {
    const { listSoulIds } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      listSoulIds(new AbortController().signal),
    ).rejects.toMatchObject({ code: "missing_keys" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards upstream errors with code='upstream_error'", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { detail: "boom" }));
    const { listSoulIds } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      listSoulIds(new AbortController().signal),
    ).rejects.toMatchObject({ code: "upstream_error" });
  });
});

/* ------------------------------ listSoulStyles ------------------------------ */

describe("listSoulStyles", () => {
  function setEnv() {
    process.env.HIGGSFIELD_API_KEY = "key";
    process.env.HIGGSFIELD_API_SECRET = "secret";
  }

  it("hits /v1/text2image/soul-styles/v2 with the LEGACY auth header pair (hf-api-key + hf-secret)", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, [
        {
          id: "95151de0-e0e5-4e04-bd45-c58c8a4ac023",
          name: "Street photography",
          description: "",
          preview_url: "https://cdn.example/street.webp",
        },
      ]),
    );

    const { listSoulStyles } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const items = await listSoulStyles(new AbortController().signal);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://platform.higgsfield.ai/v1/text2image/soul-styles/v2",
    );
    const headers = init?.headers as Record<string, string>;
    // Legacy scheme — NOT the consolidated `Authorization: Key` form.
    expect(headers["hf-api-key"]).toBe("key");
    expect(headers["hf-secret"]).toBe("secret");
    expect(headers.Authorization).toBeUndefined();

    expect(items).toEqual([
      {
        id: "95151de0-e0e5-4e04-bd45-c58c8a4ac023",
        name: "Street photography",
        description: "",
        previewUrl: "https://cdn.example/street.webp",
      },
    ]);
  });

  it("normalises preview_url → previewUrl and defaults description to empty string", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, [
        {
          id: "uuid-1",
          name: "A",
          // No description, no preview_url — defensive payload shape.
        },
      ]),
    );
    const { listSoulStyles } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const items = await listSoulStyles(new AbortController().signal);
    expect(items[0]).toEqual({
      id: "uuid-1",
      name: "A",
      description: "",
      previewUrl: "",
    });
  });

  it("filters out malformed rows (missing id or name)", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, [
        { id: "ok", name: "Good" },
        { id: "no-name" }, // missing name
        { name: "no-id" }, // missing id
        null,
      ]),
    );
    const { listSoulStyles } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const items = await listSoulStyles(new AbortController().signal);
    expect(items.map((i) => i.id)).toEqual(["ok"]);
  });

  it("returns an empty array when the upstream payload isn't an array (defensive)", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { unexpected: true }));
    const { listSoulStyles } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const items = await listSoulStyles(new AbortController().signal);
    expect(items).toEqual([]);
  });

  it("throws code='missing_keys' when env vars are absent", async () => {
    const { listSoulStyles } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      listSoulStyles(new AbortController().signal),
    ).rejects.toMatchObject({ code: "missing_keys" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards upstream errors with code='upstream_error'", async () => {
    setEnv();
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { detail: "down" }));
    const { listSoulStyles } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    await expect(
      listSoulStyles(new AbortController().signal),
    ).rejects.toMatchObject({ code: "upstream_error" });
  });
});
