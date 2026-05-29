"use client";

import { startReactiveRunner } from "@/lib/engine/reactive-runner";
import { getProjectRepository } from "@/lib/repositories/supabase-project-repository";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useSaveStatusStore } from "@/lib/stores/save-status-store";
import { hydrateChatForProject } from "@/lib/sync/chat-sync";
import { startAutoPersistGenerations } from "@/lib/sync/generation-sync";
import { startAutoSave } from "@/lib/sync/project-sync";

import { applyProjectDocument } from "./document";

/**
 * ProjectSession — the single owner of the open-project lifecycle
 * (Phase 3). The shell delegates here so all the fragile teardown / reset
 * / load / rehydrate / re-subscribe ordering lives in one race-guarded
 * place instead of being sprinkled across an effect.
 *
 * `openProject` is guarded by a monotonically-increasing token: if the
 * user navigates to another project while a load is in flight, the older
 * load sees its token superseded and bails WITHOUT applying state, so two
 * rapid switches can never interleave one project's graph with another's
 * subscriptions.
 */

export interface OpenProjectArgs {
  projectId: string;
  userId: string;
  onError?: (err: unknown) => void;
}

export interface OpenProjectResult {
  ok: boolean;
  /** The project id was not found (or RLS-hidden) — caller should redirect. */
  notFound?: boolean;
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

/** Tear down the current session (subscriptions). Used on unmount/logout. */
export function closeProject(): void {
  // Bump the token so any in-flight openProject bails before applying.
  activeToken += 1;
  runTeardown();
}

/**
 * Open (or switch to) a project: tear down the previous session, point the
 * execution store at this project's cache namespace, load the document
 * from the cloud, apply it (graph + assets + layout + rehydrated results),
 * then start the per-project subscriptions (autosave, generation persist,
 * reactive runner, chat).
 */
export async function openProject({
  projectId,
  userId,
  onError,
}: OpenProjectArgs): Promise<OpenProjectResult> {
  const token = (activeToken += 1);

  // Tear down the previous session and reset runtime state for the swap.
  runTeardown();
  useExecutionStore.getState().setActiveProject(projectId);
  useProjectStore.getState().setId(projectId);
  useSaveStatusStore.getState().set("idle");

  let project;
  try {
    project = await getProjectRepository().getById(projectId);
  } catch (err) {
    onError?.(err);
    return { ok: false };
  }

  // Superseded by a newer openProject/closeProject while awaiting — bail
  // without touching the stores (the newer call owns the state now).
  if (token !== activeToken) return { ok: false };
  if (!project) return { ok: false, notFound: true };

  // Apply the document: graph + assets + layout + rehydrated node results
  // (records come back as `cached`, so generation-sync won't re-insert).
  applyProjectDocument(project.state as unknown as Record<string, unknown>);
  useProjectStore.getState().setId(project.id);
  useProjectStore.getState().setName(project.name);

  // Start subscriptions. generation-sync is a singleton (tears down its
  // own prior subscription); the others return their own unsubscribes.
  const unsubSave = startAutoSave({
    projectId: project.id,
    ownerId: userId,
    onSaving: () => useSaveStatusStore.getState().set("saving"),
    onSaved: () => useSaveStatusStore.getState().set("saved"),
    onError: (err) => {
      useSaveStatusStore.getState().set("error");
      onError?.(err);
    },
  });
  const unsubGen = startAutoPersistGenerations({ ownerId: userId });
  const unsubReactive = startReactiveRunner();
  teardownFns = [unsubSave, unsubGen, unsubReactive];

  // Fire-and-forget chat hydration — failures don't block the canvas.
  void hydrateChatForProject(project.id);

  return { ok: true };
}

/** Test-only: reset the module-level token + teardown registry. */
export function _resetSessionForTests(): void {
  activeToken = 0;
  teardownFns = [];
}
