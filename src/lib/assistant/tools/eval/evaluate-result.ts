import { z } from "zod";

import { callOpenRouter } from "@/lib/llm/call-openrouter";
import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";

import type { AssistantTool } from "../index";

/**
 * evaluate_result — Slice 7.4 (ADR-0043).
 *
 * Run a vision LLM over a single generated image (or arbitrary URL)
 * and return a structured eval against the user's criteria.
 *
 * Why a dedicated tool when the assistant already has chat completions?
 * Because the eval LLM gets a TIGHT, EXPENSIVE prompt + a JSON schema
 * to follow. Done as a freeform turn the model would soft-evaluate
 * with hedging text. As a tool, it's a focused subroutine — caller
 * gets a clean `{ score, strengths, weaknesses, reasoning }` shape.
 *
 * The eval call uses Anthropic's claude-haiku-4.5 by default — vision-
 * capable, fast, cheap, well-aligned for visual critique.
 */

const argsSchema = z
  .object({
    generationId: z.string().optional(),
    imageUrl: z.string().url().optional(),
    criteria: z.string().min(1),
    /** Override eval model. Default: anthropic/claude-haiku-4.5. */
    model: z.string().optional(),
  })
  .strict()
  .refine((args) => args.generationId || args.imageUrl, {
    message: "Pass either generationId or imageUrl.",
  });

const EVAL_SYSTEM = `You are a visual critique assistant. Evaluate the image against the user's criteria.

Respond with ONLY a JSON object matching:

{
  "score": number,           // 0..1, holistic match against criteria
  "strengths": string[],     // 1-4 bullet points of what works
  "weaknesses": string[],    // 0-4 bullet points of what doesn't
  "reasoning": string        // 1-3 sentences tying score to evidence
}

No markdown fences. No prose outside the JSON. Be specific (cite visible elements, lighting, composition, likeness, color, etc.).`;

const evalSchema = z.object({
  score: z.number().min(0).max(1),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  reasoning: z.string(),
});

function stripFences(s: string): string {
  const m = s.trim().match(/^```(?:json)?\n([\s\S]*?)\n```$/);
  return m ? m[1]!.trim() : s.trim();
}

export const evaluateResultTool: AssistantTool = {
  name: "evaluate_result",
  description:
    "Score a generated image against user-supplied criteria using a vision LLM. Pass `generationId` (preferred) OR a raw `imageUrl`. Returns structured eval { score 0-1, strengths, weaknesses, reasoning }. Use after a run to verify outputs match intent before showing the user.",
  parameters: {
    type: "object",
    properties: {
      generationId: {
        type: "string",
        description:
          "Generation row id. Tool fetches the image url + ensures it's still in storage.",
      },
      imageUrl: {
        type: "string",
        description: "Direct URL. Fallback when no generationId is in scope.",
      },
      criteria: {
        type: "string",
        description:
          "What 'good' looks like — matches the user's stated intent. e.g. 'photorealistic portrait of subject in 16:9 cinematic lighting'.",
      },
      model: {
        type: "string",
        description:
          "Override eval model (must be vision-capable). Default: anthropic/claude-haiku-4.5.",
      },
    },
    required: ["criteria"],
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    const args = argsSchema.parse(rawArgs);
    let url = args.imageUrl;
    if (!url && args.generationId) {
      const gen = await getGenerationRepository().get(args.generationId);
      if (!gen) {
        return {
          ok: false,
          error: `No generation with id ${args.generationId}`,
        };
      }
      // Generations store output in Universal Output shape.
      const out = gen.output as
        | { type?: string; data?: unknown; format?: string }
        | null;
      if (out?.type === "image" && typeof out.data === "string") {
        url = out.data;
      } else {
        return {
          ok: false,
          error: `Generation ${args.generationId} is not an image (type: ${out?.type ?? "unknown"})`,
        };
      }
    }
    if (!url) {
      return { ok: false, error: "No image url resolved." };
    }

    const response = await callOpenRouter({
      model: args.model ?? "anthropic/claude-haiku-4.5",
      system: EVAL_SYSTEM,
      user: `Criteria: ${args.criteria}`,
      images: [url],
      temperature: 0,
      maxTokens: 600,
      signal: ctx.signal ?? new AbortController().signal,
    });

    let parsed: z.infer<typeof evalSchema>;
    try {
      parsed = evalSchema.parse(JSON.parse(stripFences(response.text)));
    } catch (err) {
      return {
        ok: false,
        error: `Eval LLM returned invalid JSON: ${(err as Error).message}`,
        rawText: response.text,
      };
    }
    return {
      ok: true,
      ...parsed,
      ...(response.costUsd !== undefined ? { costUsd: response.costUsd } : {}),
    };
  },
};
