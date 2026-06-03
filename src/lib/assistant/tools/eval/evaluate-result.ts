import { z } from "zod";

import { callOpenRouter } from "@/lib/llm/call-openrouter";
import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";

import type { AssistantTool } from "../index";

/**
 * evaluate_result — Slice 7.4 (ADR-0043).
 *
 * Run an LLM over a single generated **image OR text** result (or
 * arbitrary URL / text snippet) and return a structured eval against
 * the user's criteria.
 *
 * 2026-06: text-output support added. The original tool rejected any
 * generation whose `output.type` wasn't `image`. With LLM Text nodes
 * + Seedance Prompt Director landing, the assistant needs to be able
 * to score those outputs too. For text we drop the vision attachment,
 * embed the body in the user message, and reuse the same scoring
 * shape so callers don't have to branch.
 *
 * Why a dedicated tool when the assistant already has chat completions?
 * Because the eval LLM gets a TIGHT, EXPENSIVE prompt + a JSON schema
 * to follow. Done as a freeform turn the model would soft-evaluate
 * with hedging text. As a tool, it's a focused subroutine — caller
 * gets a clean `{ score, strengths, weaknesses, reasoning }` shape.
 *
 * The eval call uses Anthropic's claude-haiku-4.5 by default — fast,
 * cheap, vision-capable AND text-capable, well-aligned for critique.
 */

const argsSchema = z
  .object({
    generationId: z.string().optional(),
    imageUrl: z.string().url().optional(),
    /**
     * Direct text snippet to evaluate (e.g. an LLM Text node output
     * the assistant has already pulled from the run records).
     * Bypasses the generation lookup entirely.
     */
    text: z.string().min(1).optional(),
    criteria: z.string().min(1),
    /** Override eval model. Default: anthropic/claude-haiku-4.5. */
    model: z.string().optional(),
  })
  .strict()
  .refine(
    (args) => args.generationId || args.imageUrl || args.text,
    {
      message: "Pass one of generationId, imageUrl, or text.",
    },
  );

const EVAL_SYSTEM = `You are a critique assistant. Evaluate the provided result (image OR text body) against the user's criteria.

Respond with ONLY a JSON object matching:

{
  "score": number,           // 0..1, holistic match against criteria
  "strengths": string[],     // 1-4 bullet points of what works
  "weaknesses": string[],    // 0-4 bullet points of what doesn't
  "reasoning": string        // 1-3 sentences tying score to evidence
}

No markdown fences. No prose outside the JSON. Be specific (cite visible elements / quoted phrases / structure / tone — whatever is in scope for the result).`;

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
    "Score a generated image OR text result against user-supplied criteria using an LLM. Pass `generationId` (preferred) OR a raw `imageUrl` OR a `text` snippet. Returns structured eval { score 0-1, strengths, weaknesses, reasoning }. Use after a run to verify outputs match intent before showing the user.",
  parameters: {
    type: "object",
    properties: {
      generationId: {
        type: "string",
        description:
          "Generation row id. Tool fetches the image url + ensures it's still in storage, OR the text body for text generations.",
      },
      imageUrl: {
        type: "string",
        description: "Direct URL. Fallback when no generationId is in scope.",
      },
      text: {
        type: "string",
        description:
          "Direct text snippet to evaluate (e.g. LLM Text node output). Skips the generation lookup.",
      },
      criteria: {
        type: "string",
        description:
          "What 'good' looks like — matches the user's stated intent. e.g. 'photorealistic portrait of subject in 16:9 cinematic lighting' for an image, or 'paragraph evokes a noir mood' for text.",
      },
      model: {
        type: "string",
        description:
          "Override eval model. Default: anthropic/claude-haiku-4.5.",
      },
    },
    required: ["criteria"],
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    const args = argsSchema.parse(rawArgs);
    let imageUrlForEval: string | undefined = args.imageUrl;
    let textForEval: string | undefined = args.text;
    if (!imageUrlForEval && !textForEval && args.generationId) {
      const gen = await getGenerationRepository().get(args.generationId);
      if (!gen) {
        return {
          ok: false,
          error: `No generation with id ${args.generationId}`,
        };
      }
      const out = gen.output as
        | { type?: string; data?: unknown; format?: string }
        | null;
      if (out?.type === "image" && typeof out.data === "string") {
        imageUrlForEval = out.data;
      } else if (out?.type === "text" && typeof out.data === "string") {
        textForEval = out.data;
      } else {
        return {
          ok: false,
          error: `Generation ${args.generationId} is not a supported output type (got: ${out?.type ?? "unknown"}; supported: image, text).`,
        };
      }
    }
    if (!imageUrlForEval && !textForEval) {
      return { ok: false, error: "No image url or text resolved." };
    }

    const isTextEval = !imageUrlForEval;
    const userMessage = isTextEval
      ? `Criteria: ${args.criteria}\n\n--- TEXT TO EVALUATE ---\n${textForEval}\n--- END TEXT ---`
      : `Criteria: ${args.criteria}`;

    const response = await callOpenRouter({
      model: args.model ?? "anthropic/claude-haiku-4.5",
      system: EVAL_SYSTEM,
      user: userMessage,
      ...(isTextEval ? {} : { images: [imageUrlForEval!] }),
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
