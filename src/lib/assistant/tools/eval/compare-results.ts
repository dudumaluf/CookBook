import { z } from "zod";

import { callOpenRouter } from "@/lib/llm/call-openrouter";
import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";

import type { AssistantTool } from "../index";

/**
 * compare_results — Slice 7.4 (ADR-0043).
 *
 * Send 2-8 generated images to a vision LLM along with the user's
 * criteria and ask the model to RANK them. Returns a structured
 * ranking with notes per image — useful when the user says "which
 * of the 4 is best?" or when the assistant wants to pick a winner
 * out of a batch before showing the user.
 *
 * The compare prompt explicitly asks for distinct, evidence-backed
 * notes per image (not "image 1 is good"). This is the right level
 * of detail for the user to trust the ranking enough to act on it.
 */

const argsSchema = z
  .object({
    generationIds: z.array(z.string().min(1)).min(2).max(8),
    criteria: z.string().min(1),
    model: z.string().optional(),
  })
  .strict();

const COMPARE_SYSTEM = `You are comparing N images against the user's criteria. Rank them best to worst.

Respond with ONLY a JSON object matching:

{
  "ranking": [
    {
      "index": 1,                       // 1-based index into the original list
      "rank": 1,                        // 1 = best, ascending
      "score": 0.92,                    // 0..1 holistic quality
      "notes": string                   // 1-2 sentences citing what stands out
    },
    ...
  ],
  "summary": string                     // 1-2 sentences explaining the ranking shape
}

No markdown fences. Be specific (cite visible evidence per image).`;

const compareSchema = z.object({
  ranking: z.array(
    z.object({
      index: z.number().int().min(1),
      rank: z.number().int().min(1),
      score: z.number().min(0).max(1),
      notes: z.string(),
    }),
  ),
  summary: z.string(),
});

function stripFences(s: string): string {
  const m = s.trim().match(/^```(?:json)?\n([\s\S]*?)\n```$/);
  return m ? m[1]!.trim() : s.trim();
}

export const compareResultsTool: AssistantTool = {
  name: "compare_results",
  description:
    "Rank 2-8 generated images against criteria using a vision LLM. Pass `generationIds[]` and `criteria`. Returns ranking with per-image notes + summary. Use to pick a winner from a batch before showing the user.",
  parameters: {
    type: "object",
    properties: {
      generationIds: {
        type: "array",
        items: { type: "string" },
        description: "2-8 generation row ids.",
      },
      criteria: { type: "string" },
      model: {
        type: "string",
        description: "Override eval model. Default: anthropic/claude-haiku-4.5.",
      },
    },
    required: ["generationIds", "criteria"],
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    const args = argsSchema.parse(rawArgs);
    const repo = getGenerationRepository();
    const records = await Promise.all(
      args.generationIds.map((id) => repo.get(id)),
    );
    const urls: string[] = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (!r) {
        return {
          ok: false,
          error: `Generation ${args.generationIds[i]} not found.`,
        };
      }
      const out = r.output as
        | { type?: string; data?: unknown }
        | null;
      if (out?.type !== "image" || typeof out.data !== "string") {
        return {
          ok: false,
          error: `Generation ${r.id} is not an image (type: ${out?.type ?? "unknown"}).`,
        };
      }
      urls.push(out.data);
    }

    const response = await callOpenRouter({
      model: args.model ?? "anthropic/claude-haiku-4.5",
      system: COMPARE_SYSTEM,
      user: `Criteria: ${args.criteria}\n\nThere are ${urls.length} images. They are presented in the order they're attached.`,
      images: urls,
      temperature: 0,
      maxTokens: 1200,
      signal: ctx.signal ?? new AbortController().signal,
    });

    let parsed: z.infer<typeof compareSchema>;
    try {
      parsed = compareSchema.parse(JSON.parse(stripFences(response.text)));
    } catch (err) {
      return {
        ok: false,
        error: `Compare LLM returned invalid JSON: ${(err as Error).message}`,
        rawText: response.text,
      };
    }
    // Map back to generation ids for caller convenience.
    const idByIndex = args.generationIds;
    const enriched = parsed.ranking.map((r) => ({
      ...r,
      generationId: idByIndex[r.index - 1] ?? null,
    }));
    return {
      ok: true,
      ranking: enriched,
      summary: parsed.summary,
      ...(response.costUsd !== undefined ? { costUsd: response.costUsd } : {}),
    };
  },
};
