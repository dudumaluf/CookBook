import { useEffect } from "react";
import { create } from "zustand";

import { getPromptOverridesRepository } from "@/lib/repositories/supabase-prompt-overrides-repository";

/**
 * Cookbook Library Phase C — in-tab cache of the user's prompt
 * overrides.
 *
 * The reasoner reads through `resolvePrompt(key, ownerId)` which goes
 * straight to the DB on every call. The UI surfaces (Library Prompts
 * tab, chat-sheet override badge) need a faster source so a "do I
 * have a custom prompt?" check doesn't trigger a DB roundtrip on
 * every render. This store is that faster source — hydrated once per
 * session by `useAssistantPromptOverridesHydration` (mounted in the
 * AppShell), updated locally when the user saves / resets via the
 * Library editor.
 *
 * Cross-device safety: the reasoner does NOT read this store. It
 * reads the DB directly. So an out-of-date local store doesn't cause
 * "thought I'm using my custom prompt but I'm actually on default."
 * The store is purely a UI-facing snapshot.
 */

export interface PromptOverridesState {
  /** Map<promptKey, body>. Empty until hydrated. */
  overrides: Map<string, string>;
  /** Becomes true after the first successful hydrate completes. */
  hydrated: boolean;
  /** Fetch all overrides for the active user; replaces the local map. */
  hydrate: (ownerId: string) => Promise<void>;
  /** Local-only update (the Library editor calls this after a successful save). */
  setOverrideLocal: (promptKey: string, body: string) => void;
  /** Local-only removal (Reset → Default). */
  removeOverrideLocal: (promptKey: string) => void;
  /** Reset to a fresh empty state (useful in tests / on sign-out). */
  reset: () => void;
}

let inFlight: Promise<void> | null = null;

export const useAssistantPromptOverridesStore =
  create<PromptOverridesState>()((set) => ({
    overrides: new Map(),
    hydrated: false,
    hydrate: async (ownerId) => {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          const rows = await getPromptOverridesRepository().list(ownerId);
          const next = new Map<string, string>();
          for (const r of rows) next.set(r.promptKey, r.body);
          set({ overrides: next, hydrated: true });
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },
    setOverrideLocal: (promptKey, body) =>
      set((s) => {
        const next = new Map(s.overrides);
        next.set(promptKey, body);
        return { overrides: next };
      }),
    removeOverrideLocal: (promptKey) =>
      set((s) => {
        if (!s.overrides.has(promptKey)) return s;
        const next = new Map(s.overrides);
        next.delete(promptKey);
        return { overrides: next };
      }),
    reset: () => set({ overrides: new Map(), hydrated: false }),
  }));

/**
 * Selector — `true` iff the user has an active override for `promptKey`.
 * Used by the chat-sheet override badge + the Library card "Custom"
 * label.
 */
export function useHasPromptOverride(promptKey: string): boolean {
  return useAssistantPromptOverridesStore((s) => s.overrides.has(promptKey));
}

/**
 * Selector — current override body, or null if none. Used by the
 * Library editor to seed the textarea.
 */
export function useOverrideBody(promptKey: string): string | null {
  return useAssistantPromptOverridesStore(
    (s) => s.overrides.get(promptKey) ?? null,
  );
}

/**
 * Hook — mount once at the AppShell to hydrate on sign-in. Re-runs
 * if `userId` changes (e.g. user signs in / out).
 */
export function useAssistantPromptOverridesHydration(args: {
  userId: string | null | undefined;
}): void {
  const { userId } = args;
  const hydrate = useAssistantPromptOverridesStore((s) => s.hydrate);
  const reset = useAssistantPromptOverridesStore((s) => s.reset);
  useEffect(() => {
    if (!userId) {
      reset();
      return;
    }
    void hydrate(userId);
  }, [userId, hydrate, reset]);
}
