import { z } from "zod";

/**
 * Shared request / response types for the LLM route.
 *
 * Exported as both Zod schemas (used by the API route for runtime validation)
 * and the inferred TS types (used by the client wrapper). Single source of
 * truth — no drift between server-side `safeParse` and the client typing.
 *
 * Lives in `src/lib/llm/` (not `src/types/`) because it's only relevant to
 * the LLM call path; keeping it co-located with the client + server helpers
 * makes the surface easy to find when extending (e.g. when streaming or
 * tool-use lands).
 */
export const llmRequestSchema = z.object({
  /** OpenRouter model id, e.g. `anthropic/claude-sonnet-4.5`. */
  model: z.string().min(1, "model is required"),
  /**
   * Concatenated user prompt (the LLM Text node already joins multi-edge
   * user chunks with blank lines before calling). Required + non-empty.
   */
  user: z.string().min(1, "user prompt is empty"),
  /** Optional system prompt. */
  system: z.string().optional(),
  /**
   * Optional image URLs (must be reachable by Fal — i.e. publicly accessible).
   * Presence routes us to the vision endpoint. Cookbook assets live in
   * Supabase Storage with public URLs so this works out of the box.
   */
  images: z.array(z.string().url()).optional(),
  /** Sampling temperature, 0–2 (Fal endpoint limits). */
  temperature: z.number().min(0).max(2).optional(),
  /** Max output tokens. */
  maxTokens: z.number().int().positive().optional(),
  /**
   * Whether to enable provider-side reasoning / chain-of-thought.
   *
   * A few Fal-router models *require* this to be `true` ("Reasoning is
   * mandatory for this endpoint" — Gemini 2.5 Pro as of Slice 3.4).
   * Most other models accept either. Omitting → provider default
   * (usually off for non-reasoning models; on for reasoning-mandatory
   * ones — but we surface the toggle so the user opts in explicitly
   * for the latter case, since "reasoning on" adds cost).
   */
  reasoning: z.boolean().optional(),
});

export type LlmRequest = z.infer<typeof llmRequestSchema>;

export interface LlmSuccessResponse {
  /** The model's text completion. */
  text: string;
  /** Echo the model that ran (useful when a provider re-routes the call). */
  model: string;
  /** Cost in USD as reported by Fal's usage block. Omitted if unavailable. */
  costUsd?: number;
  /** Best-effort token counts. */
  inputTokens?: number;
  outputTokens?: number;
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
