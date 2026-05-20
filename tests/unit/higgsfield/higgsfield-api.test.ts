import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HiggsfieldImageRequest,
  HiggsfieldSoulIdSummary,
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

    const { listSoulIds } = await import(
      "@/lib/higgsfield/higgsfield-api"
    );
    const items = await listSoulIds(new AbortController().signal);
    expect(items.map((i) => i.name)).toEqual(["A", "B"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
