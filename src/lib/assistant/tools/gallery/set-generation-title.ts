import { z } from "zod";

import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";

import type { AssistantTool } from "../index";

/**
 * set_generation_title — Tier 4 polish (2026-06-03).
 *
 * Set or clear a generation's user-facing title. The Gallery falls
 * back to `prompt_text` then `node_kind` when no title is set, so
 * passing `null` (or an empty string — the repo trims) reverts to
 * the auto-derived label.
 *
 * Use after a curation pass — "label the winning four 'Take 3 noir
 * variations'" — so the user can find them later by name instead of
 * by browsing thumbnails.
 */

const argsSchema = z
  .object({
    generationId: z.string().min(1),
    title: z.string().nullable(),
  })
  .strict();

export const setGenerationTitleTool: AssistantTool = {
  name: "set_generation_title",
  description:
    "Set or clear a generation's title. Pass `generationId` and `title` (or `null` to revert to the auto-derived label). Empty / whitespace-only titles also revert to null.",
  parameters: {
    type: "object",
    properties: {
      generationId: { type: "string" },
      title: { type: ["string", "null"] },
    },
    required: ["generationId", "title"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    try {
      await getGenerationRepository().setTitle(args.generationId, args.title);
      return { ok: true, title: args.title ?? null };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
