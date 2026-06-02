import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  DEFAULT_ROLE_ID,
  resolveRole,
  type AssistantRole,
} from "@/lib/assistant/roles";

/**
 * Assistant role store — Cookbook Library Phase D1 (ADR-0061).
 *
 * Persists the user's role choice per browser. Mirrors the shape of
 * `assistant-settings-store` so consumers (reasoner, role-picker UI)
 * have a familiar surface.
 *
 * Why persisted in localStorage (vs session-only): the user picks
 * "Storyboard Director" once because they're working on a scene; on
 * the next day's session they're probably still working on it. A
 * session-only store would force a re-pick every session, which is
 * exactly the friction the role picker exists to avoid.
 *
 * Hydration safety: a stale localStorage value (role id we no longer
 * ship — e.g. dropped from the registry between releases) falls back
 * to General via `resolveRole`. The raw value stays in the persisted
 * blob — if a future release re-introduces the id, the user keeps
 * their choice.
 */

interface AssistantRoleState {
  /**
   * Active role id — the registry key. Defaults to `general`. Empty
   * string is also valid + treated as `general` via `getRoleId`.
   */
  roleId: string;

  /** Pick a role; trims whitespace; empty = General. */
  setRoleId: (id: string) => void;

  /** Reset to General (the default). */
  reset: () => void;

  /**
   * Read-with-fallback. Returns the persisted id if it's a known
   * role; otherwise General. The reasoner reads through this so a
   * stale id never injects an empty overlay by accident.
   */
  getRoleId: () => string;

  /**
   * Read the resolved role record (id, label, description, overlay).
   * Convenience for the role picker — it doesn't have to also import
   * `resolveRole`.
   */
  getRole: () => AssistantRole;
}

export const useAssistantRoleStore = create<AssistantRoleState>()(
  persist(
    (set, get) => ({
      roleId: DEFAULT_ROLE_ID,

      setRoleId: (id) => set({ roleId: (id ?? "").trim() || DEFAULT_ROLE_ID }),
      reset: () => set({ roleId: DEFAULT_ROLE_ID }),

      getRoleId: () => {
        const raw = get().roleId;
        return raw && raw.length > 0 ? raw : DEFAULT_ROLE_ID;
      },

      getRole: () => resolveRole(get().getRoleId()),
    }),
    {
      name: "cookbook.assistant-role",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({ roleId: state.roleId }),
    },
  ),
);

/**
 * Module-level helper for the reasoner — read the active role's
 * overlay without subscribing to the store. Empty string is a valid
 * return (General role) and means "no overlay".
 */
export function getActiveRoleOverlay(): string {
  return resolveRole(useAssistantRoleStore.getState().getRoleId())
    .systemPromptOverlay;
}

/** Module-level helper — read the active role record. */
export function getActiveRole(): AssistantRole {
  return resolveRole(useAssistantRoleStore.getState().getRoleId());
}
