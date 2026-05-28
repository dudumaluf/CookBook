import { z } from "zod";

import { getUserPreferencesRepository } from "@/lib/repositories/supabase-user-preferences-repository";

import type { AssistantTool } from "../index";

/**
 * update_user_preferences — Slice 7.6 (ADR-0045).
 *
 * Shallow-merge a patch onto the user's preferences blob. Set a value
 * to `null` to delete the key. Use to persist learnings across
 * sessions ("user prefers 16:9", "user wants cinematic by default").
 *
 * Recommend calling AFTER the user explicitly confirms a preference
 * (or after the user repeats it 2+ times), not on speculation.
 */

const argsSchema = z
  .object({
    patch: z.record(z.string(), z.unknown()),
  })
  .strict();

export const updateUserPreferencesTool: AssistantTool = {
  name: "update_user_preferences",
  description:
    "Persist a preferences patch (shallow-merge). Use AFTER the user confirms a preference or repeats it 2+ times. Set keys to null to delete. Returns the updated preferences blob.",
  parameters: {
    type: "object",
    properties: {
      patch: {
        type: "object",
        description:
          "Free-form key-value pairs. Examples: { preferred_aspect_ratio: '16:9', preferred_lighting: 'cinematic' }.",
      },
    },
    required: ["patch"],
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    const args = argsSchema.parse(rawArgs);
    if (!ctx.ownerId) {
      return { ok: false, error: "no authenticated owner" };
    }
    const updated = await getUserPreferencesRepository().patch(
      ctx.ownerId,
      args.patch,
    );
    return {
      ok: true,
      preferences: updated.preferences,
      updatedAt: updated.updatedAt,
    };
  },
};
