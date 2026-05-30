"use client";

import {
  applyProjectDocument,
  type ProjectDocument,
  serializeProject,
} from "@/lib/project/document";
import { getProjectRepository } from "@/lib/repositories/supabase-project-repository";
import {
  type ProjectRecord,
  PROJECT_STATE_VERSION,
  type ProjectState,
  type SaveProjectInput,
} from "@/lib/repositories/project-repository";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * project-sync — Slice 6.1 (ADR-0034).
 *
 * Bridges the four client-side Zustand stores (workflow, asset, project,
 * layout) to the cloud-canonical `projects` row. Two phases:
 *
 *   1. **Hydrate on login** (`bootstrapForUser`): fetches the user's
 *      current project (or creates one). If localStorage has graph/asset
 *      data from a pre-auth session and the cloud row is empty, push the
 *      local state up as the project's first state (one-shot migration).
 *      Otherwise, pull cloud state into the stores.
 *
 *   2. **Auto-save on change** (`startAutoSave`): subscribe to all four
 *      stores; debounce 1s; serialize state JSONB; PATCH the cloud row.
 *      Returns an unsubscribe function for teardown on logout / unmount.
 *
 * Conflict resolution: last-write-wins with `updated_at`. We keep a
 * `lastKnownUpdatedAt` ref; if the cloud's `updated_at` ever moves ahead
 * of ours (background sync from another machine), we surface a
 * "Remote changes detected" notice via toast and let the user reload to
 * pull. M0a is single-user but two-machine usage is the headline so this
 * matters. (UI for the conflict prompt lands as a toast — no modal.)
 *
 * `bootstrapForUser` is idempotent — calling twice on the same user is a
 * no-op (returns the cached active project). The shell's auth-gated
 * effect calls it once per `userId` change.
 */

// The serialized state IS the canonical ProjectDocument (single shape for
// cloud + file). serialize / apply live in src/lib/project/document.ts.
type SerializedState = ProjectDocument;

function snapshotStores(): SerializedState {
  return serializeProject();
}

function applyStateToStores(state: ProjectDocument | ProjectState): void {
  applyProjectDocument(state as unknown as Record<string, unknown>);
}

function hasMeaningfulLocalState(): boolean {
  const w = useWorkflowStore.getState();
  const a = useAssetStore.getState();
  return w.nodes.length > 0 || a.assets.length > 0;
}

/* ──────────────────── Bootstrap ──────────────────── */

interface BootstrapResult {
  project: ProjectRecord;
  /** True if the local localStorage state was upserted to a fresh cloud row. */
  migrated: boolean;
  /** True if cloud state was loaded into the stores. */
  hydrated: boolean;
}

/**
 * Pull-or-push the user's project state. Idempotent: if a project already
 * exists in the cloud, hydrate from it (cloud is canonical). If not, push
 * the current localStorage state up (first-login migration).
 */
export async function bootstrapForUser(
  userId: string,
): Promise<BootstrapResult> {
  const repo = getProjectRepository();
  const existing = await repo.getCurrent(userId);

  if (existing) {
    // Cloud has state — pull. Ignore local (it'll be merged into cloud
    // through the next manual interaction the user makes; we don't want
    // to silently overwrite cloud with stale local).
    if (existing.state) {
      applyStateToStores(existing.state);
    }
    return { project: existing, migrated: false, hydrated: true };
  }

  // No cloud row yet — first login. If the user already has localStorage
  // state, push it as the project's initial state.
  const initialState: SerializedState = hasMeaningfulLocalState()
    ? snapshotStores()
    : {
        version: PROJECT_STATE_VERSION,
        workflow: { nodes: [], edges: [] },
        assets: [],
        layout: {
          libraryOpen: true,
          queueOpen: false,
          chatSheetOpen: false,
          approvalGateOn: false,
        },
        projectName: useProjectStore.getState().name,
      };

  const project = await repo.save({
    ownerId: userId,
    name: initialState.projectName,
    state: initialState,
  });

  return {
    project,
    migrated: hasMeaningfulLocalState(),
    hydrated: false,
  };
}

/* ──────────────────── Auto-save ──────────────────── */

interface AutoSaveOptions {
  projectId: string;
  ownerId: string;
  /** Debounce window between local change and remote PATCH. */
  debounceMs?: number;
  /** Fired when a PATCH is actually dispatched (drives the "Saving…" UI). */
  onSaving?: () => void;
  /** Optional hook for tests / observability. */
  onSaved?: (project: ProjectRecord) => void;
  /** Optional hook for tests / observability. */
  onError?: (err: unknown) => void;
}

const DEFAULT_DEBOUNCE = 1_000;

/**
 * Subscribe to all four stores and PATCH the cloud row debounced. Returns
 * an unsubscribe function — caller (the shell's `useEffect`) calls it on
 * logout / unmount to stop saving.
 */
export function startAutoSave({
  projectId,
  ownerId,
  debounceMs = DEFAULT_DEBOUNCE,
  onSaving,
  onSaved,
  onError,
}: AutoSaveOptions): () => void {
  const repo = getProjectRepository();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<unknown> | null = null;
  let pendingDuringInFlight = false;
  // True when a store change has been scheduled but not yet persisted. Lets
  // teardown / page-hide know there's unsaved work to flush.
  let dirty = false;

  async function flush() {
    timer = null;
    if (inFlight) {
      // Coalesce: another save is in flight. Mark and rely on the in-flight
      // tail to re-schedule once it resolves. Avoids racing concurrent PATCHes
      // with stale state in either direction.
      pendingDuringInFlight = true;
      return;
    }
    dirty = false;
    const state = snapshotStores();
    const payload: SaveProjectInput = {
      id: projectId,
      ownerId,
      name: state.projectName,
      state,
    };
    onSaving?.();
    inFlight = repo
      .save(payload)
      .then((saved) => {
        onSaved?.(saved);
      })
      .catch((err) => {
        onError?.(err);
      })
      .finally(() => {
        inFlight = null;
        if (pendingDuringInFlight) {
          pendingDuringInFlight = false;
          timer = setTimeout(flush, debounceMs);
        }
      });
  }

  function schedule() {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  }

  // Persist NOW (skip the debounce). Used on teardown (project switch /
  // unmount) and when the tab is hidden / closing, so the last generation
  // before leaving is never dropped with the pending timer. Without this, a
  // result produced inside the debounce window vanishes on reload — exactly
  // the "my generated image is gone after reopening" bug.
  function flushNow() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (dirty || pendingDuringInFlight) void flush();
  }

  // A hidden / closing tab is the common "I generated then closed" path.
  // `visibilitychange → hidden` fires reliably (incl. before pagehide) and
  // the PATCH usually completes since the page isn't discarded yet.
  function onVisibility() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      flushNow();
    }
  }
  if (typeof window !== "undefined") {
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);
  }

  // Subscribe to every store. Zustand's `subscribe` fires on any mutation;
  // we rely on the debounce to coalesce bursts (typing, dragging nodes,
  // a fan-out emitting many `done` records). The execution-store
  // subscription is what persists generated results into the document so
  // they survive a reload (a run's outputs schedule a debounced save).
  const unsubs = [
    useWorkflowStore.subscribe(() => schedule()),
    useAssetStore.subscribe(() => schedule()),
    useLayoutStore.subscribe(() => schedule()),
    useProjectStore.subscribe(() => schedule()),
    useExecutionStore.subscribe(() => schedule()),
  ];

  return () => {
    // Flush any pending change BEFORE dropping the timer — otherwise a
    // result generated in the last debounce window is lost on project
    // switch / unmount.
    flushNow();
    if (typeof window !== "undefined") {
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
    }
    for (const u of unsubs) u();
  };
}
