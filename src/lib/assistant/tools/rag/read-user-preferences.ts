import { z } from "zod";

import { getUserPreferencesRepository } from "@/lib/repositories/supabase-user-preferences-repository";

import type { AssistantTool } from "../index";

const argsSchema = z.object({}).strict();

export const readUserPreferencesTool: AssistantTool = {
  name: "read_user_preferences",
  description:
    "Read the user's saved preferences blob (cross-session, cross-project). Returns { preferences: {...}, updatedAt } or { preferences: {} } when none saved yet. Read at the start of a session to surface 'the user usually wants 16:9 / cinematic / claude-haiku' before constructing.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    argsSchema.parse(rawArgs ?? {});
    if (!ctx.ownerId) {
      return { ok: false, error: "no authenticated owner" };
    }
    const record = await getUserPreferencesRepository().get(ctx.ownerId);
    return {
      ok: true,
      preferences: record?.preferences ?? {},
      updatedAt: record?.updatedAt ?? null,
    };
  },
};
