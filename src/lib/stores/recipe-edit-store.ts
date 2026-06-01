import { create } from "zustand";

import type {
  RecipeExposedHandle,
  RecipeExposedParam,
} from "@/lib/repositories/recipe-repository";

/**
 * Recipe-edit store — Cookbook Library Phase B1 (ADR-0051).
 *
 * Transient client state for "we are currently editing recipe <id> at
 * /recipes/<id>/edit". NOT persisted — purely a runtime flag plus the
 * exposed I/O captured at edit-open so saving back preserves the
 * recipe's public surface area without re-detecting it from the
 * (now possibly mutated) subgraph.
 *
 * Why a dedicated store and not, say, a field on `useLayoutStore`:
 *   - The reactive runner and other engine bits inspect this to back
 *     off (no auto-runs while editing a recipe — see
 *     `reactive-runner.ts`).
 *   - Persisting it would be wrong: page reload should not silently
 *     dump you back into edit mode mid-flow. The route IS the
 *     authority; the store mirrors the route within a tab session.
 *
 * Lifecycle:
 *   - `enter()` — called by `recipe-edit-session.openRecipeForEdit`
 *     after hydrating the workflow store with the recipe's subgraph.
 *   - `setUnsaved(true)` — called by canvas mutations during edit;
 *     gates the Discard confirm dialog and a `beforeunload` warning.
 *   - `exit()` — called by `recipe-edit-session.closeRecipeEdit` after
 *     a Save or Discard, always before clearing the workflow store.
 */
export interface RecipeEditExposed {
  inputs: RecipeExposedHandle[];
  outputs: RecipeExposedHandle[];
  params: RecipeExposedParam[];
}

export interface RecipeEditState {
  /** Cloud `cookbook_recipes` row id we're editing. null = not in edit mode. */
  recipeId: string | null;
  /** Snapshot of the recipe's name at edit-open (header banner only). */
  recipeName: string | null;
  /** Recipe's `version` at edit-open. Display-only — Save bumps it on the server. */
  currentVersion: number | null;
  /** Captured at edit-open; preserved verbatim into the saved subgraph
   *  unless we ever build a Phase B re-detect flow. */
  exposed: RecipeEditExposed;
  /** Set true on the first canvas mutation; reset on Save / Discard. */
  hasUnsavedChanges: boolean;

  enter: (args: {
    recipeId: string;
    recipeName: string;
    currentVersion: number;
    exposed: RecipeEditExposed;
  }) => void;
  exit: () => void;
  setUnsaved: (next: boolean) => void;
  /** Test helper — reset to defaults without going through enter/exit. */
  _reset: () => void;
}

const DEFAULT_EXPOSED: RecipeEditExposed = {
  inputs: [],
  outputs: [],
  params: [],
};

export const useRecipeEditStore = create<RecipeEditState>()((set) => ({
  recipeId: null,
  recipeName: null,
  currentVersion: null,
  exposed: DEFAULT_EXPOSED,
  hasUnsavedChanges: false,

  enter: ({ recipeId, recipeName, currentVersion, exposed }) =>
    set({
      recipeId,
      recipeName,
      currentVersion,
      exposed,
      hasUnsavedChanges: false,
    }),

  exit: () =>
    set({
      recipeId: null,
      recipeName: null,
      currentVersion: null,
      exposed: DEFAULT_EXPOSED,
      hasUnsavedChanges: false,
    }),

  setUnsaved: (next) => set({ hasUnsavedChanges: next }),

  _reset: () =>
    set({
      recipeId: null,
      recipeName: null,
      currentVersion: null,
      exposed: DEFAULT_EXPOSED,
      hasUnsavedChanges: false,
    }),
}));

/**
 * Pure helper — module-level so engine bits (reactive-runner) can
 * cheaply check edit state without subscribing to the React-tied hook.
 */
export function isRecipeEditActive(): boolean {
  return useRecipeEditStore.getState().recipeId !== null;
}
