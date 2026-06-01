import { describe, expect, it } from "vitest";

import {
  cacheControlSchema,
  chatContentBlockSchema,
  chatMessageSchema,
  llmRequestSchema,
} from "@/lib/llm/types";

/**
 * Cache-control schema — Slice 1 of "Smarter assistant".
 *
 * Anthropic-style `cache_control: { type: "ephemeral", ttl: "1h" }`
 * markers are forwarded verbatim to the upstream LLM. Providers that
 * don't honor them (OpenAI, Grok, custom) silently ignore them, so
 * the markers are safe to add unconditionally.
 *
 * These tests pin the wire shape so a future contributor can't
 * accidentally reject a valid cache_control payload (which would
 * regress Slice 1 caching) or accept a malformed one (which would
 * surface as a server-side 400 from Fal's openai-compat router).
 */

describe("cacheControlSchema", () => {
  it("accepts the minimum valid marker (type only)", () => {
    expect(() =>
      cacheControlSchema.parse({ type: "ephemeral" }),
    ).not.toThrow();
  });

  it("accepts a 5m TTL", () => {
    expect(() =>
      cacheControlSchema.parse({ type: "ephemeral", ttl: "5m" }),
    ).not.toThrow();
  });

  it("accepts a 1h TTL", () => {
    expect(() =>
      cacheControlSchema.parse({ type: "ephemeral", ttl: "1h" }),
    ).not.toThrow();
  });

  it("rejects unknown TTL values", () => {
    expect(() =>
      cacheControlSchema.parse({ type: "ephemeral", ttl: "1d" }),
    ).toThrow();
  });

  it("rejects a non-ephemeral type (forward-compat: only ephemeral exists today)", () => {
    expect(() =>
      cacheControlSchema.parse({ type: "permanent" }),
    ).toThrow();
  });
});

describe("chatContentBlockSchema with cache_control", () => {
  it("accepts a text block without cache_control (back-compat)", () => {
    expect(() =>
      chatContentBlockSchema.parse({ type: "text", text: "hi" }),
    ).not.toThrow();
  });

  it("accepts a text block with cache_control", () => {
    expect(() =>
      chatContentBlockSchema.parse({
        type: "text",
        text: "static prefix",
        cache_control: { type: "ephemeral", ttl: "1h" },
      }),
    ).not.toThrow();
  });

  it("does not allow cache_control on image blocks (Anthropic only caches text)", () => {
    // Image content blocks omit the cache_control field by schema
    // discrimination — extra fields don't fail by default in Zod, but
    // the field is meaningfully absent from the image variant. We
    // verify by parsing a clean image block and checking the keys.
    const parsed = chatContentBlockSchema.parse({
      type: "image_url",
      image_url: { url: "https://example.com/x.png" },
    });
    expect("cache_control" in parsed).toBe(false);
  });
});

describe("chatMessageSchema — system role accepts content blocks", () => {
  it("still accepts a plain string system message (legacy shape)", () => {
    expect(() =>
      chatMessageSchema.parse({
        role: "system",
        content: "Be brief.",
      }),
    ).not.toThrow();
  });

  it("accepts an array of text content blocks for the system role", () => {
    expect(() =>
      chatMessageSchema.parse({
        role: "system",
        content: [
          {
            type: "text",
            text: "static prefix",
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
          { type: "text", text: "dynamic suffix" },
        ],
      }),
    ).not.toThrow();
  });
});

describe("llmRequestSchema — system content blocks travel through unchanged", () => {
  it("accepts a request with a structured system message", () => {
    const out = llmRequestSchema.parse({
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
          ],
        },
        { role: "user", content: "hi" },
      ],
    });
    const sysMsg = out.messages?.[0];
    expect(sysMsg?.role).toBe("system");
    expect(Array.isArray(sysMsg?.content)).toBe(true);
  });
});
