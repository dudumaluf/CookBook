import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  DEFAULT_ASSISTANT_MODEL,
  resolveModel,
} from "@/lib/assistant/models";

/**
 * Assistant settings store — Slice 0 of "Smarter assistant".
 *
 * Persists per-browser preferences for the assistant. Today's only
 * setting is `model` (which LLM drives the reasoner); the store is
 * carved out as its own surface so future preferences (max cost,
 * narration verbosity, …) land here without bloating the chat /
 * layout stores.
 *
 * Hydration safety: a stale localStorage value (model id we no
 * longer recognize) falls back to the default in `getModel`. The
 * raw value still lives in the persisted blob — switching back to a
 * version that knows the id will pick it up unchanged. Nothing is
 * silently rewritten on load.
 */

interface AssistantSettingsState {
  /**
   * Selected model id — the OpenRouter id passed verbatim to the
   * reasoner. May be a curated catalog id or a user-typed custom
   * `provider/model-name` string. Empty = "use default".
   */
  model: string;

  setModel: (id: string) => void;
  /** Reset to the default model. */
  reset: () => void;
  /**
   * Read-with-fallback. Returns the persisted id if non-empty,
   * otherwise the default. The reasoner reads through this so a
   * stale empty string never reaches the LLM call.
   */
  getModel: () => string;
}

export const useAssistantSettingsStore = create<AssistantSettingsState>()(
  persist(
    (set, get) => ({
      model: DEFAULT_ASSISTANT_MODEL,

      setModel: (id) => set({ model: (id ?? "").trim() }),
      reset: () => set({ model: DEFAULT_ASSISTANT_MODEL }),
      getModel: () => {
        const raw = get().model;
        return raw && raw.length > 0 ? raw : DEFAULT_ASSISTANT_MODEL;
      },
    }),
    {
      name: "cookbook.assistant-settings",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({ model: state.model }),
    },
  ),
);

/**
 * Convenience for non-component callers (the reasoner, the prompt
 * bar's submit handler). Resolves the persisted id through the model
 * catalog so the caller gets capability metadata in one read.
 */
export function getActiveModel() {
  return resolveModel(useAssistantSettingsStore.getState().getModel());
}
