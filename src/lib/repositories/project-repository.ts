/**
 * ProjectRepository — Slice 6.1 (ADR-0034).
 *
 * Storage abstraction for project entities. Lands the Repository pattern
 * promised since ADR-0005 (M2 cloud sync). Today the only implementation
 * is `SupabaseProjectRepository`; future variants (offline cache, IndexedDB
 * fallback, integration test in-memory mock) drop in without touching
 * sync logic / stores / UI.
 *
 * Single project per user in M0a. The interface already speaks `list()` so
 * multi-project lands without a refactor.
 *
 * `state` is a typed JSON blob owned by the client — schema lives in the
 * sync layer, not here. This keeps the repository agnostic to the
 * workflow / asset / layout shape and lets schema evolve via in-store
 * migrations without rewriting the repository.
 */

export interface ProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  /** Client-owned JSONB blob. See `project-sync.ts` for the actual schema. */
  state: ProjectState;
  /** Bumped by the client whenever `state` shape changes. */
  stateVersion: number;
  /** ISO timestamp from the server. Source of truth for last-write-wins. */
  updatedAt: string;
  createdAt: string;
  /** Soft-delete marker — projects with this set are filtered out by `list()`. */
  deletedAt: string | null;
}

/**
 * Canonical project state shape. Keep this in sync with `project-sync.ts`'s
 * serializer. JSONB on the server, plain JS object here.
 *
 * `version` lets clients migrate older payloads forward — same playbook as
 * the workflow-store's local migrations, just on the cloud side.
 */
export interface ProjectState {
  version: number;
  projectName?: string;
  workflow?: {
    nodes: unknown[];
    edges: unknown[];
  };
  assets?: unknown[];
  /** Loose: the precise layout shape is owned by `project/document.ts`. */
  layout?: unknown;
  /**
   * Per-node last output + history (v2). Makes the project document
   * self-contained so reloading restores generated results, not just the
   * graph. Shape owned by `src/lib/project/document.ts`.
   */
  executionState?: Record<string, unknown>;
}

// v2: added `executionState` (per-node results/history) + `projectName`.
// Additive — v1 payloads load fine (fields simply absent).
export const PROJECT_STATE_VERSION = 2;

export interface ProjectRepository {
  /**
   * Returns the user's most recently updated active (non-deleted) project,
   * or `null` if they have none. Callers should treat `null` as "create a
   * fresh project" — see `getOrCreate()` for that flow.
   */
  getCurrent(userId: string): Promise<ProjectRecord | null>;

  /** All non-deleted projects, newest-updated first. M0a usually returns one. */
  list(userId: string): Promise<ProjectRecord[]>;

  /**
   * Fetch a specific (non-deleted) project by id. RLS enforces ownership,
   * so a project belonging to another user resolves `null`. Used by the
   * per-project URL routes (`/projetos/[id]`).
   */
  getById(id: string): Promise<ProjectRecord | null>;

  /**
   * Deep-copy a project into a new row owned by the same user (Save a
   * copy / Duplicate). Returns the new record.
   */
  duplicate(id: string, name?: string): Promise<ProjectRecord>;

  /** Insert or update a project record. Server bumps `updated_at` on update. */
  save(project: SaveProjectInput): Promise<ProjectRecord>;

  /**
   * Convenience: get-or-create the user's current project. Used by the sync
   * layer on first login when the user has no project yet but might have
   * localStorage state to upsert.
   */
  getOrCreate(userId: string, fallbackName?: string): Promise<ProjectRecord>;

  /**
   * Lightweight rename — only writes the `name` column, doesn't touch
   * `state`. The sync layer's debounced save already covers state changes;
   * keeping rename separate avoids a round-trip just to flush the new title.
   */
  rename(id: string, name: string): Promise<void>;

  /** Set `deleted_at = now()`. Doesn't drop the row. */
  softDelete(id: string): Promise<void>;
}

export interface SaveProjectInput {
  /** Omit to insert; provide to update an existing row. */
  id?: string;
  ownerId: string;
  name: string;
  state: ProjectState;
  stateVersion?: number;
}

/**
 * Repository-shaped error. Lets callers branch on stable codes without
 * pattern-matching against Supabase / Postgres error strings.
 */
export class ProjectRepositoryError extends Error {
  readonly code:
    | "not_found"
    | "permission_denied"
    | "conflict"
    | "network"
    | "unknown";
  constructor(message: string, code: ProjectRepositoryError["code"]) {
    super(message);
    this.name = "ProjectRepositoryError";
    this.code = code;
  }
}
