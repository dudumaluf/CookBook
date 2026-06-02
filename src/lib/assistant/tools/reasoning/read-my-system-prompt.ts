import { z } from "zod";

import { resolveRole } from "@/lib/assistant/roles";
import { useAssistantRoleStore } from "@/lib/stores/assistant-role-store";
import { resolvePrompt, PROMPT_KEYS } from "@/lib/prompts/resolve-prompt";
import { REASONER_INSTRUCTIONS } from "@/lib/assistant/instructions";

import type { AssistantTool } from "../index";

const argsSchema = z.object({}).strict();

/**
 * `read_my_system_prompt` — Cookbook Library Phase C.
 *
 * Lets the assistant read its own currently-active operating
 * instructions during a turn. Returns the body the next reasoner
 * call would inject, plus metadata so the assistant knows which
 * pieces it's looking at:
 *
 *   - `body` — the resolved REASONER_INSTRUCTIONS (override OR default).
 *   - `isOverride` — true iff the user has a custom override active.
 *   - `roleId` / `roleLabel` / `roleOverlay` — the active role and
 *     the overlay text appended after the reasoner instructions.
 *   - `defaultBody` — the bundled default, useful when the assistant
 *     is comparing its current state against the canonical version
 *     (e.g. for `propose_prompt_edit`).
 *
 * No side effects. Safe to call any time. Use this BEFORE proposing
 * an edit so you can show the user the actual current text instead
 * of guessing.
 */
export const readMySystemPromptTool: AssistantTool = {
  name: "read_my_system_prompt",
  description:
    "Read the assistant's own operating instructions as they will be used on the next turn — the resolved REASONER_INSTRUCTIONS (custom override OR default) plus the active role's system-prompt overlay. Use this before proposing edits to your own prompt so the user sees an accurate diff. No side effects.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    argsSchema.parse(rawArgs ?? {});
    const ownerId = ctx.ownerId ?? null;
    const resolved = await resolvePrompt(
      PROMPT_KEYS.ASSISTANT_REASONER,
      ownerId,
    ).catch(() => ({
      content: REASONER_INSTRUCTIONS,
      isOverride: false,
      defaultContent: REASONER_INSTRUCTIONS,
      updatedAt: null,
    }));
    const role = resolveRole(useAssistantRoleStore.getState().getRoleId());
    return {
      ok: true,
      promptKey: PROMPT_KEYS.ASSISTANT_REASONER,
      body: resolved.content,
      isOverride: resolved.isOverride,
      defaultBody: resolved.defaultContent,
      updatedAt: resolved.updatedAt,
      roleId: role.id,
      roleLabel: role.label,
      roleOverlay: role.systemPromptOverlay,
    };
  },
};
