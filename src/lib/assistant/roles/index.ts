import { GENERAL_ROLE } from "./general";
import { PROMPT_ENGINEER_ROLE } from "./prompt-engineer";
import { RECIPE_ARCHITECT_ROLE } from "./recipe-architect";
import { STORYBOARD_DIRECTOR_ROLE } from "./storyboard-director";
import { TIMELINE_DIRECTOR_ROLE } from "./timeline-director";
import type { AssistantRole } from "./types";

export type { AssistantRole };

/**
 * Role registry — Cookbook Library Phase D1 (ADR-0061).
 *
 * Ordered list (general first, then specialists alphabetical-ish by
 * use-case adjacency). The role picker iterates this array verbatim
 * so the order is the UI order. `general` MUST stay at index 0
 * because the role-store falls back to it on hydration miss.
 */
export const ROLES: ReadonlyArray<AssistantRole> = [
  GENERAL_ROLE,
  PROMPT_ENGINEER_ROLE,
  STORYBOARD_DIRECTOR_ROLE,
  TIMELINE_DIRECTOR_ROLE,
  RECIPE_ARCHITECT_ROLE,
];

/** Default role id when nothing is persisted / picked. */
export const DEFAULT_ROLE_ID = GENERAL_ROLE.id;

/**
 * Resolve a role id to a role record. Falls back to General when the
 * id isn't in the registry — covers stale localStorage values from a
 * pruned role and typo-bearing imports.
 */
export function resolveRole(id: string | null | undefined): AssistantRole {
  if (!id) return GENERAL_ROLE;
  return ROLES.find((r) => r.id === id) ?? GENERAL_ROLE;
}

export {
  GENERAL_ROLE,
  PROMPT_ENGINEER_ROLE,
  RECIPE_ARCHITECT_ROLE,
  STORYBOARD_DIRECTOR_ROLE,
  TIMELINE_DIRECTOR_ROLE,
};
