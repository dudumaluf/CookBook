import { z } from "zod";

import { callOpenRouter } from "@/lib/llm/call-openrouter";
import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";

import type { AssistantTool } from "../index";

/**
 * compare_results — Slice 7.4 (ADR-0043).
 *
 * Send 2-8 generated results (all images, or all text) to an LLM
 * along with the user's criteria and ask the model to RANK them.
 * Returns a structured ranking with notes per item — useful when
 * the user says "which of the 4 is best?" or when the assistant
 * wants to pick a winner out of a batch before showing the user.
 *
 * 2026-06: text-output support added. The original tool rejected
 * any generation whose `output.type` wasn't `image`. With LLM Text
 * + Seedance Prompt Director writing batches of variants, the
 * assistant needs to be able to rank text outputs too. We require
 * that all N generations share the same output kind (image or
 * text) — comparing apples to oranges would give a noisy ranking.
 *
 * The compare prompt explicitly asks for distinct, evidence-backed
 * notes per item (not "image 1 is good"). This is the right level
 * of detail for the user to trust the ranking enough to act on it.
 */

const argsSchema = z
  .object({
    generationIds: z.array(z.string().min(1)).min(2).max(8),
    criteria: z.string().min(1),
    model: z.string().optional(),
  })
  .strict();

const COMPARE_SYSTEM = `You are comparing N results (all images, or all text bodies) against the user's criteria. Rank them best to worst.

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

No markdown fences. Be specific (cite visible evidence per image, or quoted phrases / structural traits per text body).`;

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
    "Rank 2-8 generated results (all images OR all text bodies) against criteria using an LLM. Pass `generationIds[]` and `criteria`. Returns ranking with per-item notes + summary. Use to pick a winner from a batch before showing the user. All generations must share the same output kind.",
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
    const texts: string[] = [];
    let mode: "image" | "text" | null = null;
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
      const t = out?.type;
      if (t === "image" && typeof out?.data === "string") {
        if (mode === "text") {
          return {
            ok: false,
            error: `Mixed output kinds: generation ${r.id} is image but earlier generations were text. compare_results requires all generations share one kind.`,
          };
        }
        mode = "image";
        urls.push(out.data);
      } else if (t === "text" && typeof out?.data === "string") {
        if (mode === "image") {
          return {
            ok: false,
            error: `Mixed output kinds: generation ${r.id} is text but earlier generations were image. compare_results requires all generations share one kind.`,
          };
        }
        mode = "text";
        texts.push(out.data);
      } else {
        return {
          ok: false,
          error: `Generation ${r.id} has unsupported output type: ${t ?? "unknown"} (supported: image, text).`,
        };
      }
    }

    const isTextCompare = mode === "text";
    const userMessage = isTextCompare
      ? [
          `Criteria: ${args.criteria}`,
          ``,
          `There are ${texts.length} text candidates, in order:`,
          ``,
          ...texts.map(
            (body, i) =>
              `--- TEXT ${i + 1} ---\n${body}\n--- END TEXT ${i + 1} ---`,
          ),
        ].join("\n")
      : `Criteria: ${args.criteria}\n\nThere are ${urls.length} images. They are presented in the order they're attached.`;

    const response = await callOpenRouter({
      model: args.model ?? "anthropic/claude-haiku-4.5",
      system: COMPARE_SYSTEM,
      user: userMessage,
      ...(isTextCompare ? {} : { images: urls }),
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
