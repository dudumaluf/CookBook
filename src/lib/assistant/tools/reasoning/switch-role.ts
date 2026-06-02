import { z } from "zod";

import { ROLES, resolveRole } from "@/lib/assistant/roles";
import { useAssistantRoleStore } from "@/lib/stores/assistant-role-store";

import type { AssistantTool } from "../index";

const argsSchema = z
  .object({
    to: z
      .string()
      .min(1)
      .describe(
        "Target role id. Must be one of the known roles (see `knownRoles` in suggest_recipes_for_intent or roles registry).",
      ),
    reason: z
      .string()
      .min(1)
      .describe(
        "One-sentence rationale shown to the user — what changed and why this role fits.",
      ),
  })
  .strict();

/**
 * `switch_role` — Phase E (Cookbook Library, ADR-0064).
 *
 * Lets the assistant change its own active role mid-conversation.
 * Idempotent — switching to the role that's already active is a
 * no-op (returns `{ ok: true, switched: false }`). Unknown role ids
 * are rejected; the response includes the full known-roles list so
 * the caller can recover.
 *
 * IMPORTANT: switching the role takes effect on the NEXT turn (the
 * static prefix in this turn's request was already built with the
 * old overlay). The tool returns `nextTurnRoleId` to make this
 * explicit; the assistant should phrase its message to the user as
 * "I'm switching to <role> for the next step" rather than acting as
 * if the new role's expertise applies inside the same turn.
 *
 * Side effect: writes to `useAssistantRoleStore`. Persisted to
 * localStorage via the store's `persist` middleware so the choice
 * survives reload.
 */
export const switchRoleTool: AssistantTool = {
  name: "switch_role",
  description:
    "Change the assistant's active role for the NEXT turn. Use when the user's intent maps better to a specialist (e.g. storyboard work → storyboard-director, prompt crafting → prompt-engineer). The new role's overlay applies starting the next user turn; this turn finishes under the old role. Always include a short `reason` so the user understands the switch in the trace.",
  parameters: {
    type: "object",
    properties: {
      to: {
        type: "string",
        description: "Role id (e.g. 'storyboard-director', 'prompt-engineer').",
      },
      reason: {
        type: "string",
        description:
          "Plain-English rationale — what about the user's intent triggers this switch.",
      },
    },
    required: ["to", "reason"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs ?? {});
    const known = ROLES.map((r) => ({ id: r.id, label: r.label }));
    const isKnown = ROLES.some((r) => r.id === args.to);
    if (!isKnown) {
      return {
        ok: false,
        error: `Unknown role id '${args.to}'.`,
        knownRoles: known,
      };
    }

    const before = useAssistantRoleStore.getState().getRoleId();
    if (before === args.to) {
      return {
        ok: true,
        switched: false,
        from: before,
        to: args.to,
        reason: args.reason,
        knownRoles: known,
        hint:
          "Already in this role — no change needed. The assistant should proceed under the existing role.",
      };
    }
    useAssistantRoleStore.getState().setRoleId(args.to);
    const role = resolveRole(args.to);
    return {
      ok: true,
      switched: true,
      from: before,
      to: args.to,
      label: role.label,
      reason: args.reason,
      nextTurnRoleId: args.to,
      knownRoles: known,
      hint:
        "Role changed for the NEXT turn. Phrase your message to the user as 'switching to <label> for the next step'; do not act as if the specialist overlay is already in effect on this turn.",
    };
  },
};
