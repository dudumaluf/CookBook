import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler tests for /api/llm/chat-completions (Slice 7.1).
 *
 * Mock the server wrapper so we only exercise the route's
 * responsibilities — body parsing, Zod validation, error → HTTP
 * mapping. The wrapper itself has its own unit tests.
 */

const { callChatCompletions } = vi.hoisted(() => ({
  callChatCompletions: vi.fn(),
}));
vi.mock("@/lib/llm/chat-completions", () => ({
  callChatCompletions,
}));

import { POST } from "@/app/api/llm/chat-completions/route";

function makeRequest(body: unknown, init?: { aborted?: boolean }): Request {
  const ctrl = new AbortController();
  if (init?.aborted) ctrl.abort();
  return new Request("http://localhost/api/llm/chat-completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: ctrl.signal,
  });
}

beforeEach(() => {
  callChatCompletions.mockReset();
});

describe("POST /api/llm/chat-completions", () => {
  it("returns 400 with code='invalid_request' when the body isn't JSON", async () => {
    const res = await POST(makeRequest("not json{") as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
  });

  it("returns 400 when neither `messages` nor `user` is provided", async () => {
    const res = await POST(
      makeRequest({ model: "anthropic/claude-sonnet-4.5" }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_request");
  });

  it("accepts the legacy { user, system } shape and forwards to the wrapper", async () => {
    callChatCompletions.mockResolvedValue({
      text: "ok",
      model: "anthropic/claude-sonnet-4.5",
    });
    const res = await POST(
      makeRequest({
        model: "anthropic/claude-sonnet-4.5",
        user: "Hi",
        system: "Be brief.",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(callChatCompletions).toHaveBeenCalledTimes(1);
    const [args] = callChatCompletions.mock.calls[0]!;
    expect(args.user).toBe("Hi");
    expect(args.system).toBe("Be brief.");
  });

  it("accepts the new { messages[] } shape", async () => {
    callChatCompletions.mockResolvedValue({
      text: "ok",
      model: "anthropic/claude-sonnet-4.5",
    });
    const res = await POST(
      makeRequest({
        model: "anthropic/claude-sonnet-4.5",
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Hi" },
        ],
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(callChatCompletions).toHaveBeenCalledTimes(1);
    const [args] = callChatCompletions.mock.calls[0]!;
    expect(args.messages).toHaveLength(2);
  });

  it("returns 499 with code='aborted' when the wrapper throws AbortError", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    callChatCompletions.mockRejectedValue(abortErr);
    const res = await POST(
      makeRequest({
        model: "anthropic/claude-sonnet-4.5",
        user: "Hi",
      }) as never,
    );
    expect(res.status).toBe(499);
    const body = await res.json();
    expect(body.code).toBe("aborted");
  });

  it("returns 500 with code='missing_key' when env var is unset", async () => {
    const err = new Error("FAL_KEY missing");
    (err as Error & { code?: string }).code = "missing_key";
    callChatCompletions.mockRejectedValue(err);
    const res = await POST(
      makeRequest({
        model: "anthropic/claude-sonnet-4.5",
        user: "Hi",
      }) as never,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("missing_key");
  });

  it("returns 502 with code='upstream_error' when the provider rejects", async () => {
    const err = new Error("provider down");
    (err as Error & { code?: string }).code = "upstream_error";
    callChatCompletions.mockRejectedValue(err);
    const res = await POST(
      makeRequest({
        model: "anthropic/claude-sonnet-4.5",
        user: "Hi",
      }) as never,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("upstream_error");
  });

  it("returns 500 with code='unknown' for unmapped errors", async () => {
    callChatCompletions.mockRejectedValue(new Error("kaboom"));
    const res = await POST(
      makeRequest({
        model: "anthropic/claude-sonnet-4.5",
        user: "Hi",
      }) as never,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("unknown");
  });

  it("forwards tools[] and toolChoice through to the wrapper (Slice 7.3 prep)", async () => {
    callChatCompletions.mockResolvedValue({
      text: "",
      model: "anthropic/claude-sonnet-4.5",
      toolCalls: [
        {
          id: "tc1",
          type: "function",
          function: { name: "read_canvas", arguments: "{}" },
        },
      ],
      finishReason: "tool_calls",
    });
    const res = await POST(
      makeRequest({
        model: "anthropic/claude-sonnet-4.5",
        messages: [{ role: "user", content: "what's on the canvas?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "read_canvas",
              description: "Returns the current canvas as JSON",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        toolChoice: "auto",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.toolCalls).toHaveLength(1);
    expect(body.finishReason).toBe("tool_calls");
  });
});
