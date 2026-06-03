import { z } from "zod";

import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";

import type { AssistantTool } from "../index";

/**
 * pin_generation — Tier 4 polish (2026-06-03).
 *
 * Toggle the `pinned` flag on a generation row. The Gallery already
 * lets the user click a star to pin a generation as "this one is
 * worth keeping at the top of the list". This tool lets the assistant
 * do the same after a comparison ("the third option won — pinning
 * it") without forcing a UI hand-off.
 *
 * RLS does the actual permission check at the DB layer. We surface
 * the repo error to the LLM as `{ ok: false, error }` so it can
 * narrate "I couldn't pin that — looks like it belongs to a
 * different account" rather than silently dropping the call.
 */

const argsSchema = z
  .object({
    generationId: z.string().min(1),
    pinned: z.boolean(),
  })
  .strict();

export const pinGenerationTool: AssistantTool = {
  name: "pin_generation",
  description:
    "Pin or un-pin a generation in the Gallery. Pass `generationId` and `pinned: boolean`. Use after a `compare_results` or `evaluate_result` ranking to mark the winner.",
  parameters: {
    type: "object",
    properties: {
      generationId: { type: "string" },
      pinned: { type: "boolean" },
    },
    required: ["generationId", "pinned"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    try {
      await getGenerationRepository().setPinned(args.generationId, args.pinned);
      return { ok: true, pinned: args.pinned };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
