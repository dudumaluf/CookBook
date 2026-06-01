import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callChatCompletions } from "@/lib/llm/chat-completions";

/**
 * Slice 7.1 — chat-completions wrapper unit tests. Stub global.fetch
 * with a fake provider response so the wrapper exercises:
 *   - request body construction (legacy + native shapes)
 *   - response parsing (text + tool_calls + usage)
 *   - error handling (HTTP non-OK, abort, network)
 */

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_FAL_KEY = process.env.FAL_KEY;

beforeEach(() => {
  process.env.FAL_KEY = "test-fal-key";
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_FAL_KEY === undefined) {
    delete process.env.FAL_KEY;
  } else {
    process.env.FAL_KEY = ORIGINAL_FAL_KEY;
  }
});

function mockFetchOnce(response: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  bodyText?: string;
}): typeof fetch {
  const fn = vi.fn().mockResolvedValueOnce({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: vi.fn().mockResolvedValue(response.body ?? {}),
    text: vi.fn().mockResolvedValue(response.bodyText ?? ""),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn as unknown as typeof fetch;
}

const FAKE_OK_RESPONSE = {
  id: "chatcmpl-1",
  model: "anthropic/claude-sonnet-4.5",
  choices: [
    {
      index: 0,
      message: { role: "assistant" as const, content: "Hello!" },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 4,
    total_tokens: 14,
    cost: 0.0005,
  },
};

describe("callChatCompletions", () => {
  it("builds messages[] from legacy { user, system } shape", async () => {
    const fetchMock = mockFetchOnce({ body: FAKE_OK_RESPONSE });
    await callChatCompletions(
      {
        model: "anthropic/claude-sonnet-4.5",
        user: "Hi",
        system: "Be brief.",
      },
      new AbortController().signal,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hi" },
    ]);
  });

  it("includes image_url blocks when images are passed in legacy mode", async () => {
    const fetchMock = mockFetchOnce({ body: FAKE_OK_RESPONSE });
    await callChatCompletions(
      {
        model: "anthropic/claude-sonnet-4.5",
        user: "Describe these.",
        images: [
          "https://supabase.test/cookbook-assets/a.png",
          "https://supabase.test/cookbook-assets/b.png",
        ],
      },
      new AbortController().signal,
    );
    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    const userMsg = body.messages[0];
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content[0]).toEqual({
      type: "text",
      text: "Describe these.",
    });
    expect(userMsg.content[1].type).toBe("image_url");
    expect(userMsg.content[2].type).toBe("image_url");
  });

  it("forwards messages[] verbatim when caller provides native shape", async () => {
    const fetchMock = mockFetchOnce({ body: FAKE_OK_RESPONSE });
    const messages = [
      { role: "system" as const, content: "system" },
      { role: "user" as const, content: "first" },
      { role: "assistant" as const, content: "reply" },
      { role: "user" as const, content: "follow-up" },
    ];
    await callChatCompletions(
      { model: "anthropic/claude-sonnet-4.5", messages },
      new AbortController().signal,
    );
    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual(messages);
  });

  it("forwards tools[] + tool_choice + parallel_tool_calls + max_tokens", async () => {
    const fetchMock = mockFetchOnce({ body: FAKE_OK_RESPONSE });
    await callChatCompletions(
      {
        model: "anthropic/claude-sonnet-4.5",
        user: "Hi",
        tools: [
          {
            type: "function",
            function: {
              name: "read_canvas",
              description: "...",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        toolChoice: "auto",
        parallelToolCalls: false,
        maxTokens: 800,
      },
      new AbortController().signal,
    );
    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.max_tokens).toBe(800);
  });

  it("returns toolCalls[] + finishReason from the response", async () => {
    mockFetchOnce({
      body: {
        model: "anthropic/claude-sonnet-4.5",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "tc-1",
                  type: "function",
                  function: { name: "read_canvas", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });
    const out = await callChatCompletions(
      {
        model: "anthropic/claude-sonnet-4.5",
        messages: [{ role: "user", content: "tool me" }],
      },
      new AbortController().signal,
    );
    expect(out.text).toBe("");
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls?.[0]?.function.name).toBe("read_canvas");
    expect(out.finishReason).toBe("tool_calls");
  });

  it("includes Authorization header from the provider", async () => {
    const fetchMock = mockFetchOnce({ body: FAKE_OK_RESPONSE });
    await callChatCompletions(
      { model: "anthropic/claude-sonnet-4.5", user: "Hi" },
      new AbortController().signal,
    );
    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.headers.Authorization).toBe("Key test-fal-key");
  });

  it("throws missing_key when FAL_KEY is unset (default provider)", async () => {
    delete process.env.FAL_KEY;
    await expect(
      callChatCompletions(
        { model: "anthropic/claude-sonnet-4.5", user: "Hi" },
        new AbortController().signal,
      ),
    ).rejects.toThrowError(/FAL_KEY missing/);
  });

  it("throws AbortError when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      callChatCompletions(
        { model: "anthropic/claude-sonnet-4.5", user: "Hi" },
        ctrl.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("wraps non-OK HTTP into upstream_error with the provider's message when JSON", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      bodyText: JSON.stringify({ error: { message: "model overloaded" } }),
    });
    try {
      await callChatCompletions(
        { model: "anthropic/claude-sonnet-4.5", user: "Hi" },
        new AbortController().signal,
      );
      throw new Error("expected throw");
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe("upstream_error");
      expect((e as Error).message).toContain("model overloaded");
    }
  });

  /* ────────────────────────────────────────────────────────────────── */
  /* Slice 1 of "Smarter assistant" — cache token telemetry              */
  /* ────────────────────────────────────────────────────────────────── */

  describe("cache token telemetry (Slice 1)", () => {
    it("surfaces Anthropic cache fields when present in usage", async () => {
      mockFetchOnce({
        body: {
          model: "anthropic/claude-sonnet-4.5",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 200,
            completion_tokens: 10,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 7128,
          },
        },
      });
      const out = await callChatCompletions(
        { model: "anthropic/claude-sonnet-4.5", user: "Hi" },
        new AbortController().signal,
      );
      expect(out.cacheReadTokens).toBe(7128);
      expect(out.cacheCreationTokens).toBe(0);
    });

    it("maps Gemini's cached_content_token_count onto cacheReadTokens", async () => {
      mockFetchOnce({
        body: {
          model: "google/gemini-2.5-pro",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 20,
            cached_content_token_count: 850,
          },
        },
      });
      const out = await callChatCompletions(
        { model: "google/gemini-2.5-pro", user: "Hi" },
        new AbortController().signal,
      );
      expect(out.cacheReadTokens).toBe(850);
      expect(out.cacheCreationTokens).toBeUndefined();
    });

    it("omits cache fields entirely when the provider doesn't surface them", async () => {
      mockFetchOnce({ body: FAKE_OK_RESPONSE });
      const out = await callChatCompletions(
        { model: "openai/gpt-4o", user: "Hi" },
        new AbortController().signal,
      );
      expect(out.cacheReadTokens).toBeUndefined();
      expect(out.cacheCreationTokens).toBeUndefined();
    });

    it("forwards a structured system message (content blocks) verbatim", async () => {
      const fetchMock = mockFetchOnce({ body: FAKE_OK_RESPONSE });
      await callChatCompletions(
        {
          model: "anthropic/claude-sonnet-4.5",
          messages: [
            {
              role: "system",
              content: [
                {
                  type: "text",
                  text: "static prefix",
                  cache_control: { type: "ephemeral", ttl: "1h" },
                },
                { type: "text", text: "dynamic suffix" },
              ],
            },
            { role: "user", content: "hi" },
          ],
        },
        new AbortController().signal,
      );
      const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content[0].cache_control).toEqual({
        type: "ephemeral",
        ttl: "1h",
      });
    });
  });
});
