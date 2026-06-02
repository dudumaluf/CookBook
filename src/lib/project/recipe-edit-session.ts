"use client";

import { closeProject } from "@/lib/project/session";
import { forkRecipe } from "@/lib/recipes/fork-recipe";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import {
  type RecipeRecord,
  type RecipeSubgraph,
  RECIPE_SUBGRAPH_VERSION,
} from "@/lib/repositories/recipe-repository";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useRecipeEditStore } from "@/lib/stores/recipe-edit-store";
import { useRecipeWatcherStore } from "@/lib/stores/recipe-watcher-store";
import { useSaveStatusStore } from "@/lib/stores/save-status-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * RecipeEditSession — the single owner of the open-recipe-for-edit
 * lifecycle (Cookbook Library Phase B1, ADR-0051). Mirrors
 * `project/session.ts` so the recipe edit page never has to know about
 * ordering: tear down the project session, hydrate workflow-store with
 * the recipe's subgraph, reset execution-store + save-status, enter
 * the recipe-edit store, subscribe to canvas mutations to flag unsaved
 * changes.
 *
 * Race-guarded by a monotonic `activeToken` so a fast back-and-forth
 * navigation can't interleave one recipe's hydration with another's.
 *
 * Forking happens here too: clicking Edit on a system recipe (or
 * navigating directly to `/recipes/<system_id>/edit`) silently forks
 * to a user-owned copy first and returns `redirectTo` so the route
 * page can `router.replace()` to the fork's URL without flashing the
 * old (now-stale) state.
 */

export interface OpenRecipeForEditArgs {
  recipeId: string;
  userId: string;
  onError?: (err: unknown) => void;
}

export interface OpenRecipeForEditResult {
  ok: boolean;
  /** Recipe id couldn't be loaded (RLS / missing). Caller redirects out. */
  notFound?: boolean;
  /** Auto-fork happened. The fork's id; caller should `router.replace`
   *  to `/recipes/<this>/edit` so the URL matches the working copy. */
  redirectTo?: string;
}

let activeToken = 0;
let teardownFns: Array<() => void> = [];

function runTeardown(): void {
  for (const fn of teardownFns) {
    try {
      fn();
    } catch {
      /* best-effort teardown */
    }
  }
  teardownFns = [];
}

export async function openRecipeForEdit(
  args: OpenRecipeForEditArgs,
): Promise<OpenRecipeForEditResult> {
  const token = (activeToken += 1);

  // Tear down previous session of any kind. Project subscriptions must
  // be off before we replace workflow-store contents — otherwise a
  // pending autosave would write the recipe's nodes into the project's
  // cloud row.
  closeProject();
  runTeardown();
  useExecutionStore.getState().setActiveProject(`recipe-edit:${args.recipeId}`);
  useSaveStatusStore.getState().set("idle");

  let recipe: RecipeRecord | null;
  try {
    recipe = await getRecipeRepository().get(args.recipeId);
  } catch (err) {
    args.onError?.(err);
    return { ok: false };
  }

  // Superseded — newer call owns the state now; bail without writing.
  if (token !== activeToken) return { ok: false };
  if (!recipe) return { ok: false, notFound: true };

  // System recipes can't be edited directly — RLS would refuse the RPC,
  // and conceptually a user editing the System Seedance Director should
  // get their own copy. Silently fork + redirect.
  if (recipe.ownerId === null) {
    let fork: RecipeRecord;
    try {
      fork = await forkRecipe({
        source: recipe,
        ownerId: args.userId,
        nameSuffix: " (your copy)",
      });
    } catch (err) {
      args.onError?.(err);
      return { ok: false };
    }
    if (token !== activeToken) return { ok: false };
    return { ok: true, redirectTo: fork.id };
  }

  // Recipe exists but isn't owned by the caller. We could fork here too
  // (for "edit someone else's recipe" sharing), but Phase B1 keeps that
  // surface closed — return notFound so the route bounces to the projects
  // index. Public sharing is a Phase E concern.
  if (recipe.ownerId !== args.userId) {
    return { ok: false, notFound: true };
  }

  // Hydrate the canvas with the recipe's subgraph. We replace the
  // workflow-store wholesale rather than going through the project
  // document path because (a) we don't want the asset-store / layout-
  // store to change, and (b) recipes don't carry execution-state.
  useWorkflowStore.setState({
    nodes: recipe.subgraph.nodes ?? [],
    edges: recipe.subgraph.edges ?? [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });

  // Enter edit mode AFTER hydration so any subsequent workflow-store
  // mutation reaches the dirty-flag subscriber below in a "we are in
  // edit mode" state.
  useRecipeEditStore.getState().enter({
    recipeId: recipe.id,
    recipeName: recipe.name,
    currentVersion: recipe.version,
    exposed: {
      inputs: recipe.subgraph.exposedInputs ?? [],
      outputs: recipe.subgraph.exposedOutputs ?? [],
      params: recipe.subgraph.exposedParams ?? [],
    },
  });

  // Subscribe AFTER entering edit mode + AFTER the hydration setState,
  // so the listener only fires on user mutations (not the initial
  // hydration). Flips the dirty flag on the first observed change.
  const unsubMut = useWorkflowStore.subscribe(() => {
    const editState = useRecipeEditStore.getState();
    if (editState.recipeId && !editState.hasUnsavedChanges) {
      editState.setUnsaved(true);
    }
  });
  teardownFns = [unsubMut];

  return { ok: true };
}

/**
 * Persist the current canvas as a new version of the recipe. Reads
 * workflow-store directly (no extra args needed — the route owns one
 * canvas at a time). Preserves the exposed I/O captured at edit-open
 * so renaming an internal node mid-edit doesn't silently drop a
 * public handle.
 */
export interface SaveRecipeEditArgs {
  /** Optional metadata patches. Null/undefined keeps the prior value. */
  name?: string | null;
  description?: string | null;
  category?: string | null;
  onError?: (err: unknown) => void;
}

export interface SaveRecipeEditResult {
  ok: boolean;
  record?: RecipeRecord;
}

export async function saveRecipeEdit(
  args: SaveRecipeEditArgs = {},
): Promise<SaveRecipeEditResult> {
  const editState = useRecipeEditStore.getState();
  if (!editState.recipeId) {
    return { ok: false };
  }

  const ws = useWorkflowStore.getState();
  const subgraph: RecipeSubgraph = {
    version: RECIPE_SUBGRAPH_VERSION,
    nodes: ws.nodes,
    edges: ws.edges,
    exposedInputs: editState.exposed.inputs,
    exposedOutputs: editState.exposed.outputs,
    exposedParams: editState.exposed.params,
  };

  let record: RecipeRecord;
  try {
    record = await getRecipeRepository().saveAsNewVersion({
      recipeId: editState.recipeId,
      subgraph,
      name: args.name ?? null,
      description: args.description ?? null,
      category: args.category ?? null,
    });
  } catch (err) {
    args.onError?.(err);
    return { ok: false };
  }

  // Saved cleanly — clear the dirty flag so a subsequent Discard /
  // navigate-away doesn't prompt. The store's `currentVersion` is
  // still display-only; we don't bump it here because the route is
  // about to unmount + close.
  useRecipeEditStore.getState().setUnsaved(false);

  // Phase B2: refresh the watcher store so any composite instances on
  // canvases the user navigates back to immediately learn about the new
  // version. Fire-and-forget — a failed refresh just means the badge
  // takes a beat longer to appear (focus-refresh covers it).
  void useRecipeWatcherStore.getState().refresh({
    ownerId: record.ownerId,
    includeSystem: true,
  });

  return { ok: true, record };
}

/**
 * Tear down the edit session. Bumps the token (so any in-flight
 * `openRecipeForEdit` bails before applying), unsubscribes the
 * dirty-flag listener, exits the edit store, and clears the workflow
 * store + execution-store + save-status. Called from the route's
 * `useEffect` cleanup AND from Save / Discard handlers before
 * navigating away.
 */
export function closeRecipeEdit(): void {
  activeToken += 1;
  runTeardown();
  useRecipeEditStore.getState().exit();
  useWorkflowStore.getState().clear();
  useExecutionStore.getState().setActiveProject(null);
  useSaveStatusStore.getState().set("idle");
}

/** Test-only: reset the module-level token + teardown registry. */
export function _resetRecipeEditSessionForTests(): void {
  activeToken = 0;
  teardownFns = [];
}
