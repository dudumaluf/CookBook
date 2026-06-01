/**
 * Assistant model catalog — Slice 0 of "Smarter assistant".
 *
 * Curated list of LLMs the user can pick to drive the assistant. All
 * models route through Fal's `openrouter/router/openai/v1/chat/completions`
 * endpoint (one FAL_KEY, one billing surface — see `src/lib/llm/provider.ts`).
 *
 * Each entry carries the capability metadata the rest of the system
 * needs to behave correctly per model:
 *
 *   - `caching` — whether this model honors Anthropic-style
 *     `cache_control` markers. Slice 1 only emits markers when this
 *     is true, so the request shape is identical-to-today on models
 *     that don't support caching (no regression).
 *   - `tools` — whether this model speaks OpenAI-style function
 *     calling. The reasoner refuses to drive a model that lacks
 *     this. All curated models have it; the `custom` fallback
 *     assumes it.
 *   - `tier` / `costHint` — display-only hints to help the user
 *     pick. Cost hint is intentionally fuzzy (4 buckets) — exact
 *     pricing changes upstream and we don't want to pretend we
 *     track it precisely.
 *
 * For unknown ids (user typed a custom OpenRouter model into the
 * picker), `resolveModel` returns a permissive default so the
 * reasoner still tries the call. Worst case the upstream returns
 * an error, which surfaces in the chat.
 */

export interface AssistantModel {
  /** OpenRouter model id, e.g. `anthropic/claude-sonnet-4.5`. */
  id: string;
  /** Display name for the picker. */
  label: string;
  provider:
    | "anthropic"
    | "openai"
    | "google"
    | "x-ai"
    | "meta"
    | "custom";
  tier: "fast" | "balanced" | "premium";
  /** Honors Anthropic-style `cache_control` markers (Slice 1). */
  caching: boolean;
  /** Speaks OpenAI-style function calling (required for the reasoner). */
  tools: boolean;
  /** Rough cost indicator: `$` cheapest → `$$$$` most expensive. */
  costHint: "$" | "$$" | "$$$" | "$$$$";
}

export const ASSISTANT_MODELS: readonly AssistantModel[] = [
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    provider: "anthropic",
    tier: "balanced",
    caching: true,
    tools: true,
    costHint: "$$",
  },
  {
    id: "anthropic/claude-opus-4",
    label: "Claude Opus 4",
    provider: "anthropic",
    tier: "premium",
    caching: true,
    tools: true,
    costHint: "$$$$",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    tier: "fast",
    caching: true,
    tools: true,
    costHint: "$",
  },
  {
    id: "openai/gpt-5",
    label: "GPT-5",
    provider: "openai",
    tier: "premium",
    caching: false,
    tools: true,
    costHint: "$$$",
  },
  {
    id: "openai/gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    tier: "balanced",
    caching: false,
    tools: true,
    costHint: "$$",
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
    tier: "balanced",
    caching: true,
    tools: true,
    costHint: "$$",
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    tier: "fast",
    caching: true,
    tools: true,
    costHint: "$",
  },
  {
    id: "x-ai/grok-4",
    label: "Grok 4",
    provider: "x-ai",
    tier: "balanced",
    caching: false,
    tools: true,
    costHint: "$$",
  },
];

/** Default model used when the settings store is empty / invalid. */
export const DEFAULT_ASSISTANT_MODEL: string = ASSISTANT_MODELS[0]!.id;

/**
 * Resolve a model id to its capability metadata.
 *
 * - Known curated id → exact entry.
 * - Empty / unknown id → permissive "custom" entry. We assume
 *   `tools: true` (the reasoner requires it; if upstream rejects
 *   the call the error surfaces in chat) and `caching: false`
 *   (markers ignored by definition for unknown providers, so
 *   we don't bother emitting them).
 */
export function resolveModel(id: string): AssistantModel {
  const trimmed = (id ?? "").trim();
  const found = ASSISTANT_MODELS.find((m) => m.id === trimmed);
  if (found) return found;
  return {
    id: trimmed || DEFAULT_ASSISTANT_MODEL,
    label: trimmed || "Default",
    provider: "custom",
    tier: "balanced",
    caching: false,
    tools: true,
    costHint: "$$",
  };
}

/** True when `id` matches a curated catalog entry. */
export function isKnownModel(id: string): boolean {
  return ASSISTANT_MODELS.some((m) => m.id === id);
}
