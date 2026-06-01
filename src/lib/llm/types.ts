import { z } from "zod";

/**
 * Shared request / response types for the LLM route.
 *
 * Slice 7.1 (ADR-0041) extends the schema to support the OpenAI Chat
 * Completions shape — `messages[]`, `tools[]`, `tool_choice`, `stream` —
 * so the assistant can do native tool calling and multi-turn memory in
 * later slices. The legacy "single user prompt + system + images" shape
 * stays valid (the server wrapper translates it into a `messages[]`
 * array for the upstream call). New callers should prefer `messages[]`
 * directly; old callers keep working unchanged.
 *
 * Single source of truth — no drift between server `safeParse` and
 * client typing. Lives co-located with the LLM helpers (not in
 * `src/types/`) so the surface is easy to find when the LLM contract
 * grows again.
 */

/* ────────────────────────────────────────────────────────────────────── */
/* Chat Completions message shape                                          */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * One content block inside a `messages[]` entry. Mirrors the OpenAI
 * Chat Completions content-block shape so any provider that speaks that
 * dialect (Fal openai-compat, OpenRouter direct, OpenAI direct,
 * Anthropic via OpenAI shim) accepts our payload as-is.
 *
 * Slice 1 of "Smarter assistant" extends the `text` variant with an
 * optional `cache_control` marker — Anthropic's prompt-cache hint,
 * which Anthropic + Gemini honor and other providers silently ignore.
 * The marker is forwarded verbatim so we don't need provider-specific
 * branches.
 */
export const cacheControlSchema = z.object({
  type: z.literal("ephemeral"),
  /** Optional TTL hint. Defaults to provider-specific (5m on Anthropic). */
  ttl: z.enum(["5m", "1h"]).optional(),
});

export type CacheControl = z.infer<typeof cacheControlSchema>;

export const chatContentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    cache_control: cacheControlSchema.optional(),
  }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({
      url: z.string().url(),
      detail: z.enum(["auto", "low", "high"]).optional(),
    }),
  }),
]);

export type ChatContentBlock = z.infer<typeof chatContentBlockSchema>;

/**
 * `tool_calls` array inside an assistant message — the model's
 * "I want to invoke this function" emission. Carrying these in our
 * schema lets us round-trip them through chat history when we need
 * to send the conversation back to the LLM after a tool result.
 */
export const chatToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(), // JSON-encoded; provider sometimes streams partial.
  }),
});

export type ChatToolCall = z.infer<typeof chatToolCallSchema>;

export const chatMessageSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("system"),
    // System content can be a plain string OR an array of text content
    // blocks. The latter unlocks per-block `cache_control` markers
    // (Slice 1 of "Smarter assistant"), so we can mark the static
    // prefix as cacheable while leaving the dynamic suffix uncached.
    content: z.union([z.string(), z.array(chatContentBlockSchema)]),
  }),
  z.object({
    role: z.literal("user"),
    // user content can be plain string OR multimodal blocks (vision).
    content: z.union([z.string(), z.array(chatContentBlockSchema)]),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    tool_calls: z.array(chatToolCallSchema).optional(),
  }),
  z.object({
    role: z.literal("tool"),
    content: z.string(),
    tool_call_id: z.string(),
  }),
]);

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/* ────────────────────────────────────────────────────────────────────── */
/* Tool definitions                                                        */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * One function tool the LLM can call. Schema matches OpenAI's function
 * calling spec — every provider through OpenRouter standardizes on this
 * shape, so we don't have to translate per-provider.
 *
 * Reserved for Slice 7.3 (native tool calling). 7.1 ships the schema +
 * passthrough; nothing wires it yet.
 */
export const toolDefinitionSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()), // JSON Schema (loose).
  }),
});

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

export const toolChoiceSchema = z.union([
  z.literal("auto"),
  z.literal("none"),
  z.literal("required"),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string() }),
  }),
]);

export type ToolChoice = z.infer<typeof toolChoiceSchema>;

/* ────────────────────────────────────────────────────────────────────── */
/* Request schema — both legacy + new shapes accepted                      */
/* ────────────────────────────────────────────────────────────────────── */

export const llmRequestSchema = z
  .object({
    /** OpenRouter model id, e.g. `anthropic/claude-sonnet-4.5`. */
    model: z.string().min(1, "model is required"),

    /* Legacy shape — single-turn, no multimodal mixing. The server
     * wrapper translates this into messages[] for the upstream call. */
    user: z.string().optional(),
    system: z.string().optional(),
    images: z.array(z.string().url()).optional(),

    /* New shape (Slice 7.1+) — full Chat Completions multi-turn. When
     * present, takes precedence over `user/system/images`. */
    messages: z.array(chatMessageSchema).optional(),

    /* Generation knobs (apply to either shape). */
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    /**
     * Whether to enable provider-side reasoning / chain-of-thought.
     *
     * A few Fal-router models *require* this to be `true` (Gemini 2.5
     * Pro). Most others accept either. Omitting → provider default.
     */
    reasoning: z.boolean().optional(),

    /* Tool calling — Slice 7.3 onward. Schema-validated here so the
     * route accepts them now even before the reasoner wires them. */
    tools: z.array(toolDefinitionSchema).optional(),
    toolChoice: toolChoiceSchema.optional(),
    parallelToolCalls: z.boolean().optional(),

    /* Streaming — Slice 7.3 onward. The 7.1 route currently returns a
     * single response regardless; flag is forwarded for forward-compat. */
    stream: z.boolean().optional(),
  })
  .refine(
    (v) =>
      (v.messages !== undefined && v.messages.length > 0) ||
      (v.user !== undefined && v.user.length > 0),
    {
      message: "either `messages` (≥1) or `user` (non-empty) is required",
    },
  );

export type LlmRequest = z.infer<typeof llmRequestSchema>;

/* ────────────────────────────────────────────────────────────────────── */
/* Response shape                                                          */
/* ────────────────────────────────────────────────────────────────────── */

export interface LlmSuccessResponse {
  /** The model's final text completion. Empty string when the assistant
   *  emitted only `tool_calls` (no text content). */
  text: string;
  /** Echo the model that ran (useful when a provider re-routes the call). */
  model: string;
  /** Cost in USD as reported by the provider. Omitted if unavailable. */
  costUsd?: number;
  /** Best-effort token counts. */
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Anthropic / Gemini prompt-cache telemetry (Slice 1 of "Smarter
   * assistant"). `cacheReadTokens` > 0 on a turn means the static
   * prefix was billed at the discounted rate; `cacheCreationTokens`
   * is the (one-time) write of a new cache entry. Both omitted when
   * the provider doesn't surface them.
   */
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  /** Tool calls emitted by the assistant. Empty / undefined when none. */
  toolCalls?: ChatToolCall[];
  /** OpenAI-style finish reason ("stop", "tool_calls", "length", "content_filter"). */
  finishReason?: string;
}

export interface LlmErrorResponse {
  /** Human-readable error message. Surfaced verbatim in the node's status chip + logs. */
  error: string;
  /**
   * Machine-readable code so callers can branch (e.g. retry on `rate_limited`,
   * surface a config UI on `missing_key`). Best-effort — not every failure
   * mode gets a distinct code.
   */
  code?:
    | "invalid_request"
    | "missing_key"
    | "upstream_error"
    | "aborted"
    | "unknown";
}
