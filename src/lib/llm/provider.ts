import "server-only";

/**
 * Provider abstraction — Slice 7.1 (ADR-0041).
 *
 * Centralizes WHERE LLM calls go + WHAT credentials they use, so the
 * rest of the codebase never asks "is this Fal? OpenRouter? Anthropic
 * direct?". Today there's exactly one provider — Fal's
 * `openrouter/router/openai/v1/chat/completions` endpoint, an
 * OpenAI-compatible drop-in. Same FAL_KEY we already pay; same billing
 * surface as the rest of the app's Fal usage. **No 3rd payment endpoint.**
 *
 * Why an abstraction at all when there's only one provider?
 *
 *   1. Fal's openai-compat endpoint is documented as Beta. If it
 *      changes incompatibly we want to swap to OpenRouter direct or
 *      Anthropic direct without refactoring every caller.
 *   2. Some node kinds (LLM Text) might benefit from running on a
 *      cheaper provider for batch use — the abstraction lets us route
 *      per-call later.
 *   3. Tests can swap in a mock provider without monkey-patching fetch.
 *
 * The abstraction covers TWO things every chat-completions call needs:
 *   - `endpoint` — the URL to POST to.
 *   - `authHeader` — the Authorization header value.
 *
 * Streaming, request body shape, response parsing all stay in
 * `chat-completions.ts` because every provider in this family speaks
 * the same OpenAI shape.
 */

export type ProviderId = "fal-openai-compat" | "openrouter" | "openai";

export interface LlmProvider {
  id: ProviderId;
  /** POST URL for non-streaming + streaming chat completions. */
  endpoint: string;
  /**
   * Builds the `Authorization` header for outgoing requests. Throws
   * with `code: "missing_key"` if the env var isn't set.
   */
  authHeader(): string;
}

/** Fal's OpenAI-compat router — our default. */
const falOpenaiCompat: LlmProvider = {
  id: "fal-openai-compat",
  endpoint: "https://fal.run/openrouter/router/openai/v1/chat/completions",
  authHeader() {
    const key = process.env.FAL_KEY;
    if (!key) {
      const err = new Error(
        "FAL_KEY missing from server env. Set it in .env.local — see .env.example.",
      );
      (err as Error & { code?: string }).code = "missing_key";
      throw err;
    }
    return `Key ${key}`;
  },
};

/**
 * OpenRouter direct — fallback if Fal degrades or we want to bypass
 * for any reason. Not active today; ships in 7.1 as a coded option so
 * the abstraction is real, not aspirational.
 */
const openrouterDirect: LlmProvider = {
  id: "openrouter",
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  authHeader() {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
      const err = new Error(
        "OPENROUTER_API_KEY missing — set it in .env.local before flipping the provider.",
      );
      (err as Error & { code?: string }).code = "missing_key";
      throw err;
    }
    return `Bearer ${key}`;
  },
};

/**
 * Pick the active provider. Reads `LLM_PROVIDER` env var — defaults to
 * `"fal-openai-compat"`. Set via `.env.local` to override per-deploy.
 *
 * The function is exported (not a constant) so changing the env at
 * runtime in tests / dev is observable without restarting Node.
 */
export function getProvider(): LlmProvider {
  const id = (process.env.LLM_PROVIDER ?? "fal-openai-compat") as ProviderId;
  switch (id) {
    case "openrouter":
      return openrouterDirect;
    case "openai":
      // Reserved — implement when a real reason to bypass comes up.
      throw new Error("openai provider not implemented yet");
    case "fal-openai-compat":
    default:
      return falOpenaiCompat;
  }
}
