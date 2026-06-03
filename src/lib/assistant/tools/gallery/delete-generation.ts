import { z } from "zod";

import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";

import type { AssistantTool } from "../index";

/**
 * delete_generation — Tier 4 polish (2026-06-03).
 *
 * Remove a generation row from `cookbook_generations`. Use when the
 * user says "drop the third option, that one was bad" or after a
 * `compare_results` round identifies a clear loser.
 *
 * Hard delete (matches the trash-can affordance the user sees in the
 * Gallery). The Gallery is the curated archive, distinct from the
 * project document that holds the canvas's last per-node output —
 * deleting a generation does NOT erase whatever's currently painted
 * on the canvas.
 */

const argsSchema = z
  .object({ generationId: z.string().min(1) })
  .strict();

export const deleteGenerationTool: AssistantTool = {
  name: "delete_generation",
  description:
    "Hard-delete a generation from the Gallery. Pass `generationId`. Does NOT clear the same node's canvas output — that lives in the project document, separate from the Gallery archive.",
  parameters: {
    type: "object",
    properties: {
      generationId: { type: "string" },
    },
    required: ["generationId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    try {
      await getGenerationRepository().remove(args.generationId);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
