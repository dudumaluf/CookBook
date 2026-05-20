import "server-only";

import { fal } from "@fal-ai/client";

import type { LlmRequest, LlmSuccessResponse } from "./types";

/**
 * SERVER-ONLY. Direct wrapper around Fal's OpenRouter Router endpoints.
 *
 * Lives behind the Next.js API route so the FAL_KEY never reaches the
 * browser bundle (`import "server-only"` is a build-time guard that
 * makes Next.js error if this file is reachable from a client component).
 *
 * Endpoint selection:
 *   - `images.length > 0` → `openrouter/router/vision` (multi-image input,
 *     OpenAI-compatible chat shape internally — see the Fal docs).
 *   - otherwise           → `openrouter/router` (text-only, lower latency).
 *
 * The two endpoints accept the same option subset we expose (`prompt`,
 * `system_prompt`, `model`, `temperature`, `max_tokens`) so dispatch is
 * just a different endpoint id + an additional `image_urls` field.
 *
 * Cancellation: the Fal client (v1.10) doesn't expose an AbortSignal on
 * `subscribe`, so we race the call against the signal. If the signal
 * aborts, we throw `AbortError` immediately (the underlying request may
 * still complete in the background — wasted spend, but the caller has
 * moved on; the run-engine just needs the rejection to propagate).
 */

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const key = process.env.FAL_KEY;
  if (!key) {
    const err = new Error(
      "FAL_KEY missing from server env. Set it in .env.local — see .env.example.",
    );
    (err as Error & { code?: string }).code = "missing_key";
    throw err;
  }
  fal.config({ credentials: key });
  configured = true;
}

/**
 * Subset of the Fal `usage` block that's relevant to us. `cost` is the
 * USD figure Fal computes from token usage — what we display in the
 * status chip / queue panel (Slice 3.3).
 */
interface FalUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

interface FalRouterResponse {
  output?: string;
  reasoning?: string;
  error?: string;
  usage?: FalUsage;
}

export async function callFalOpenRouter(
  args: LlmRequest,
  signal: AbortSignal,
): Promise<LlmSuccessResponse> {
  ensureConfigured();

  if (signal.aborted) {
    throw makeAbort();
  }

  // Build the per-endpoint payload inline. Each endpoint's `input` shape
  // is strongly-typed by the SDK, so we can't share a generic
  // `Record<string, unknown>` between them — and trying to do so loses
  // the type guarantees the SDK gives us for free.
  const useVision = (args.images?.length ?? 0) > 0;

  const subscribePromise = useVision
    ? fal.subscribe("openrouter/router/vision", {
        input: {
          prompt: args.user,
          model: args.model,
          image_urls: args.images!,
          ...(args.system && args.system.length > 0
            ? { system_prompt: args.system }
            : {}),
          ...(args.temperature !== undefined
            ? { temperature: args.temperature }
            : {}),
          ...(args.maxTokens !== undefined
            ? { max_tokens: args.maxTokens }
            : {}),
          // `reasoning` is a boolean on the Fal endpoint. Forward only
          // when the user has explicitly set it — letting the provider
          // default kick in otherwise.
          ...(args.reasoning !== undefined
            ? { reasoning: args.reasoning }
            : {}),
        },
        logs: false,
      })
    : fal.subscribe("openrouter/router", {
        input: {
          prompt: args.user,
          model: args.model,
          ...(args.system && args.system.length > 0
            ? { system_prompt: args.system }
            : {}),
          ...(args.temperature !== undefined
            ? { temperature: args.temperature }
            : {}),
          ...(args.maxTokens !== undefined
            ? { max_tokens: args.maxTokens }
            : {}),
          ...(args.reasoning !== undefined
            ? { reasoning: args.reasoning }
            : {}),
        },
        logs: false,
      });

  // Promise.race against the signal so an aborted run rejects ASAP.
  // The race "leaks" the in-flight subscribe (it may still resolve
  // server-side), but `runWorkflow` doesn't await it past this point
  // and the engine treats AbortError as cancellation.
  const result = await Promise.race([
    subscribePromise,
    new Promise<never>((_, reject) => {
      if (signal.aborted) return reject(makeAbort());
      signal.addEventListener("abort", () => reject(makeAbort()), {
        once: true,
      });
    }),
  ]);

  const data = result.data as FalRouterResponse;

  if (data.error) {
    const err = new Error(`Fal OpenRouter error: ${data.error}`);
    (err as Error & { code?: string }).code = "upstream_error";
    throw err;
  }
  if (!data.output || data.output.length === 0) {
    const err = new Error("Fal OpenRouter returned an empty output");
    (err as Error & { code?: string }).code = "upstream_error";
    throw err;
  }

  return {
    text: data.output,
    model: args.model,
    costUsd: data.usage?.cost,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

function makeAbort(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}
