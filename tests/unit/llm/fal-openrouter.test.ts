import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server wrapper unit tests. The wrapper has three responsibilities we
 * want to lock in:
 *   1. Lazy `FAL_KEY` configuration (with a friendly error when missing).
 *   2. Endpoint dispatch (text vs vision based on `images.length`).
 *   3. AbortSignal honoring (race against in-flight `subscribe`).
 *
 * We mock `@fal-ai/client` so we never call the real Fal API. The mocks
 * are also reset between tests so configuration cache from `ensureConfigured`
 * doesn't leak between cases — see `vi.resetModules()`.
 */

const falMock = {
  config: vi.fn(),
  subscribe: vi.fn(),
};

vi.mock("@fal-ai/client", () => ({
  fal: falMock,
}));

// Stub `server-only` — Node test env doesn't need it.
vi.mock("server-only", () => ({}));

beforeEach(() => {
  falMock.config.mockReset();
  falMock.subscribe.mockReset();
  vi.resetModules(); // wipe the `configured` cache between tests
  delete process.env.FAL_KEY;
});

afterEach(() => {
  delete process.env.FAL_KEY;
});

async function loadModule() {
  return import("@/lib/llm/fal-openrouter");
}

describe("callFalOpenRouter", () => {
  it("throws a friendly error with code='missing_key' when FAL_KEY is unset", async () => {
    const { callFalOpenRouter } = await loadModule();
    await expect(
      callFalOpenRouter(
        { model: "test/m", user: "go" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      message: /FAL_KEY/,
      code: "missing_key",
    });
    expect(falMock.config).not.toHaveBeenCalled();
  });

  it("configures the Fal client once on first call (lazy + cached)", async () => {
    process.env.FAL_KEY = "test-key";
    falMock.subscribe.mockResolvedValue({
      data: { output: "ok", usage: { cost: 0.001 } },
    });
    const { callFalOpenRouter } = await loadModule();

    await callFalOpenRouter(
      { model: "test/m", user: "go" },
      new AbortController().signal,
    );
    await callFalOpenRouter(
      { model: "test/m", user: "again" },
      new AbortController().signal,
    );

    expect(falMock.config).toHaveBeenCalledTimes(1);
    expect(falMock.config).toHaveBeenCalledWith({ credentials: "test-key" });
  });

  it("dispatches to openrouter/router (text) when no images are supplied", async () => {
    process.env.FAL_KEY = "k";
    falMock.subscribe.mockResolvedValue({ data: { output: "hi" } });
    const { callFalOpenRouter } = await loadModule();

    await callFalOpenRouter(
      {
        model: "test/m",
        user: "hello",
        system: "be terse",
        temperature: 0.7,
        maxTokens: 100,
      },
      new AbortController().signal,
    );

    expect(falMock.subscribe).toHaveBeenCalledWith("openrouter/router", {
      input: {
        prompt: "hello",
        model: "test/m",
        system_prompt: "be terse",
        temperature: 0.7,
        max_tokens: 100,
      },
      logs: false,
    });
  });

  it("dispatches to openrouter/router/vision when images are supplied", async () => {
    process.env.FAL_KEY = "k";
    falMock.subscribe.mockResolvedValue({ data: { output: "saw it" } });
    const { callFalOpenRouter } = await loadModule();

    await callFalOpenRouter(
      {
        model: "google/gemini-2.5-flash",
        user: "describe",
        images: ["https://example.com/a.png"],
      },
      new AbortController().signal,
    );

    expect(falMock.subscribe).toHaveBeenCalledWith(
      "openrouter/router/vision",
      {
        input: {
          prompt: "describe",
          model: "google/gemini-2.5-flash",
          image_urls: ["https://example.com/a.png"],
        },
        logs: false,
      },
    );
  });

  it("omits optional fields entirely (no undefined keys) when not provided", async () => {
    process.env.FAL_KEY = "k";
    falMock.subscribe.mockResolvedValue({ data: { output: "hi" } });
    const { callFalOpenRouter } = await loadModule();

    await callFalOpenRouter(
      { model: "test/m", user: "go" },
      new AbortController().signal,
    );

    const input = falMock.subscribe.mock.calls[0]![1].input as Record<
      string,
      unknown
    >;
    expect(input).toEqual({ prompt: "go", model: "test/m" });
    expect("system_prompt" in input).toBe(false);
    expect("temperature" in input).toBe(false);
    expect("max_tokens" in input).toBe(false);
    expect("image_urls" in input).toBe(false);
  });

  it("returns text + cost + token counts from a successful response", async () => {
    process.env.FAL_KEY = "k";
    falMock.subscribe.mockResolvedValue({
      data: {
        output: "the answer",
        usage: {
          cost: 0.000559,
          prompt_tokens: 1340,
          completion_tokens: 63,
          total_tokens: 1403,
        },
      },
    });
    const { callFalOpenRouter } = await loadModule();

    const result = await callFalOpenRouter(
      { model: "test/m", user: "go" },
      new AbortController().signal,
    );

    expect(result).toEqual({
      text: "the answer",
      model: "test/m",
      costUsd: 0.000559,
      inputTokens: 1340,
      outputTokens: 63,
    });
  });

  it("throws code='upstream_error' when Fal returns a structured error", async () => {
    process.env.FAL_KEY = "k";
    falMock.subscribe.mockResolvedValue({
      data: { error: "rate limited" },
    });
    const { callFalOpenRouter } = await loadModule();

    await expect(
      callFalOpenRouter(
        { model: "test/m", user: "go" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      message: /rate limited/,
      code: "upstream_error",
    });
  });

  it("throws code='upstream_error' when Fal returns empty output", async () => {
    process.env.FAL_KEY = "k";
    falMock.subscribe.mockResolvedValue({ data: { output: "" } });
    const { callFalOpenRouter } = await loadModule();

    await expect(
      callFalOpenRouter(
        { model: "test/m", user: "go" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      message: /empty output/i,
      code: "upstream_error",
    });
  });

  it("rejects with AbortError immediately when the signal is already aborted", async () => {
    process.env.FAL_KEY = "k";
    const ctrl = new AbortController();
    ctrl.abort();
    const { callFalOpenRouter } = await loadModule();

    await expect(
      callFalOpenRouter({ model: "test/m", user: "go" }, ctrl.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(falMock.subscribe).not.toHaveBeenCalled();
  });

  it("rejects with AbortError when the signal aborts mid-flight", async () => {
    process.env.FAL_KEY = "k";
    const ctrl = new AbortController();
    // subscribe never resolves so the race winner has to be the abort.
    falMock.subscribe.mockReturnValue(new Promise(() => {}));
    const { callFalOpenRouter } = await loadModule();

    const p = callFalOpenRouter(
      { model: "test/m", user: "go" },
      ctrl.signal,
    );
    setTimeout(() => ctrl.abort(), 5);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  /* Slice 3.4 — reasoning forwarding ------------------------------- */

  it("forwards `reasoning: true` to the text endpoint when set", async () => {
    process.env.FAL_KEY = "k";
    falMock.subscribe.mockResolvedValue({ data: { output: "ok" } });
    const { callFalOpenRouter } = await loadModule();

    await callFalOpenRouter(
      {
        model: "google/gemini-2.5-pro",
        user: "think hard",
        reasoning: true,
      },
      new AbortController().signal,
    );

    const input = falMock.subscribe.mock.calls[0]![1].input as Record<
      string,
      unknown
    >;
    expect(input.reasoning).toBe(true);
  });

  it("forwards `reasoning: true` to the vision endpoint when images are present", async () => {
    process.env.FAL_KEY = "k";
    falMock.subscribe.mockResolvedValue({ data: { output: "ok" } });
    const { callFalOpenRouter } = await loadModule();

    await callFalOpenRouter(
      {
        model: "google/gemini-2.5-pro",
        user: "describe carefully",
        images: ["https://example.com/x.png"],
        reasoning: true,
      },
      new AbortController().signal,
    );

    expect(falMock.subscribe.mock.calls[0]![0]).toBe(
      "openrouter/router/vision",
    );
    const input = falMock.subscribe.mock.calls[0]![1].input as Record<
      string,
      unknown
    >;
    expect(input.reasoning).toBe(true);
  });

  it("omits `reasoning` entirely when the caller leaves it undefined", async () => {
    process.env.FAL_KEY = "k";
    falMock.subscribe.mockResolvedValue({ data: { output: "ok" } });
    const { callFalOpenRouter } = await loadModule();

    await callFalOpenRouter(
      { model: "openai/gpt-5", user: "go" },
      new AbortController().signal,
    );

    const input = falMock.subscribe.mock.calls[0]![1].input as Record<
      string,
      unknown
    >;
    expect("reasoning" in input).toBe(false);
  });
});
