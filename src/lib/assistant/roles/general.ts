import type { AssistantRole } from "./types";

/**
 * General role — the default. Phase E nudge: orchestrate via recipes
 * + role hand-off when intent matches.
 *
 * The overlay is intentionally short (~200 words). Long overlays
 * burn tokens on every turn and dilute the base reasoner
 * instructions. We just point the assistant at the orchestration
 * tools; the tools' own descriptions + return payloads carry the
 * detailed contract.
 *
 * Picking General is also an explicit user choice that disables
 * specialist behavior — `setRole("general")` reads as a return-to-
 * baseline action, not a "clear" action. The orchestration nudge
 * still applies, so a user on General gets recipe + role
 * recommendations even before they pick a specialist.
 */
export const GENERAL_ROLE: AssistantRole = {
  id: "general",
  label: "General",
  description:
    "Default — handles anything. Recommends specialist roles + recipes when intent matches.",
  systemPromptOverlay: `## ROLE OVERLAY: General — Orchestrator nudge

You are the default role. You handle anything the user throws at you.
But before constructing a fresh graph, you should ALWAYS:

1. Call \`suggest_recipes_for_intent({ userMessage })\` near the start
   of any non-trivial creative request. A matching system or saved
   recipe is usually faster, better-tested, and cheaper than building
   from scratch. Empty results = green light to construct fresh.

2. If the suggestions come back with \`roleHints\` that point at a
   clearly better-fit specialist (e.g. storyboard work →
   \`storyboard-director\`, multi-beat video → \`timeline-director\`,
   single-shot scene → stay General), call \`switch_role({ to, reason })\`.
   The new role kicks in on the NEXT user turn — phrase your message
   as "switching to <Label> for the next step" so the user knows
   what just happened.

3. Idle switches are forbidden. Only switch when the recipe-match
   AND role-hint both clearly converge on a specialist; otherwise
   stay in General. The user can also pick a role from the chat
   header at any time, and you should respect that choice — only
   suggest a switch when you have a clear, evidence-based reason.

This is a recommendation system, not autonomy. The user is always
in control of which role is active.`,
};
