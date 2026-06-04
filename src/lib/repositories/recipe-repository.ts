import type { NodeInstance, WorkflowEdge } from "@/types/node";

/**
 * RecipeRepository — Slice 6.4 (ADR-0037).
 *
 * A recipe is a saved subgraph that can be re-instantiated on the canvas
 * later. Lives in the cloud-canonical `cookbook_recipes` table. System
 * recipes (`owner_id IS NULL`) are visible to everyone and seeded via SQL
 * fixtures; user recipes belong to the authenticated user.
 *
 * The schema is read-mostly during M0a — the assistant DSL queries
 * recipes to pick a template, and the user occasionally saves a canvas
 * subgraph. Phase B1 (Cookbook Library — ADR-0051) activates editing:
 * `saveAsNewVersion()` bumps the row's version + archives the prior
 * snapshot to `cookbook_recipe_versions` atomically via the
 * `cookbook_save_as_new_version` RPC.
 */

/**
 * Recipe taxonomy (2026-06-04).
 *
 * The DB column `category` is free-text for forward compatibility (a
 * future server-side classifier could write any label), but the client
 * normalizes to this fixed list so the Add Node menu can group recipes
 * deterministically and the Save dialog can offer a closed dropdown.
 *
 * Categories chosen to match the M0a–M1 surface area:
 *
 * - `describe` — text-output recipes (prompt directors, vision-to-text
 *   describers). System-shipped: Image Describer, Seedance/Storyboard/
 *   Simple Scene/Timeline Directors.
 * - `image` — image-output recipes (variation bursts, moodboards, pose
 *   sheets). Starter pack added 2026-06-04.
 * - `video` — video-output recipes (Performance Video, Lipsync). Lipsync
 *   demo added 2026-06-04.
 * - `audio` — audio-input recipes (transcript → derivative). Voice Memo
 *   Storyboard added 2026-06-04 (we have no TTS node yet, so audio-OUT
 *   recipes wait until that node lands).
 * - `utility` — cross-modal scaffolding (Storyboard from Script). Default
 *   bucket for user-saved recipes that don't fit a single output kind.
 */
export const RECIPE_CATEGORIES = [
  "describe",
  "image",
  "video",
  "audio",
  "utility",
] as const;

export type RecipeCategory = (typeof RECIPE_CATEGORIES)[number];

/**
 * Narrow an arbitrary string from the DB into a known `RecipeCategory`.
 * Returns `null` for unknown values (so callers can fall back to a
 * default like `"utility"` or skip grouping). Pure — safe to call in
 * render paths.
 */
export function coerceRecipeCategory(
  value: string | null | undefined,
): RecipeCategory | null {
  if (typeof value !== "string") return null;
  return (RECIPE_CATEGORIES as readonly string[]).includes(value)
    ? (value as RecipeCategory)
    : null;
}

/**
 * One exposed handle on a composite recipe.
 *
 * `internalNodeId` + `internalHandleId` point at the saved-subgraph
 * node + handle that the public composite handle binds to. `label` is
 * the user-visible name on the composite (defaults to the internal
 * handle's label, customizable via the Save-as-recipe modal). `dataType`
 * is captured at save time so we don't have to re-inspect the schema
 * registry when rendering the composite's handles.
 *
 * Slice 6.6 (ADR-0039) — `dataType` is a string here (rather than the
 * `DataType` literal union) so the recipe row stays decoupled from any
 * specific build's schema; we coerce at the composite-node boundary.
 */
export interface RecipeExposedHandle {
  internalNodeId: string;
  internalHandleId: string;
  label: string;
  dataType: string;
}

/**
 * One exposed *parameter* on a composite recipe (Library revamp — recipes
 * as configurable nodes). Unlike `RecipeExposedHandle` (a wire), this
 * surfaces an inner node's CONFIG field as a control on the composite, so
 * the user can tweak it without unpacking the recipe.
 *
 * `internalNodeId` + `configKey` point at the saved-subgraph node's
 * config field; editing the control writes back into that node's config
 * (per composite instance). `control` picks the widget; `options` powers
 * a `select`; `min`/`max`/`step` shape a `number`.
 */
export interface RecipeExposedParam {
  internalNodeId: string;
  configKey: string;
  label: string;
  control: "select" | "number" | "text" | "toggle";
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface RecipeSubgraph {
  /** Version tag — bumped when the subgraph shape changes. */
  version: number;
  nodes: NodeInstance[];
  edges: WorkflowEdge[];
  /**
   * Slice 6.6 — composite-mode recipes always carry these. Each public
   * handle binds to one internal-node + internal-handle pair. When a
   * recipe is instantiated as a single composite node, these become the
   * node's `getInputs(config)` / `getOutputs(config)` lookup table.
   * Expand-mode recipes (`is_node = false`) ignore the lists.
   */
  exposedInputs?: RecipeExposedHandle[];
  exposedOutputs?: RecipeExposedHandle[];
  /**
   * v2 — inner config fields surfaced as controls on the composite node
   * (recipes as configurable nodes). Absent on v1 recipes.
   */
  exposedParams?: RecipeExposedParam[];
}

// v2: adds `exposedParams` (configurable composite controls). Additive —
// v1 subgraphs load fine (the field is simply absent).
export const RECIPE_SUBGRAPH_VERSION = 2;

export interface RecipeRecord {
  id: string;
  /** null = system recipe (visible to everyone). */
  ownerId: string | null;
  name: string;
  description: string | null;
  /**
   * Coerced from the DB string at the repo boundary via
   * {@link coerceRecipeCategory} — unknown values land as `null`. The
   * Add Node menu groups recipes by this field; the Cookbook tab
   * filters by it.
   */
  category: RecipeCategory | null;
  subgraph: RecipeSubgraph;
  isNode: boolean;
  parentRecipeId: string | null;
  createdAt: string;
  /**
   * Cookbook Library Phase A — recipe-row version. Bumped on every edit
   * (Phase B1 activates this). v1 = original/never-edited. Composite-node
   * instances may carry a `recipeVersion` config so the canvas can show
   * "Update available → v(N+1)" when the recipe has moved on (Phase B2).
   */
  version: number;
}

/**
 * One historical snapshot of a recipe, captured at the moment the user
 * pressed Save in the Phase B1 edit flow. The current row stays on
 * `cookbook_recipes`; `cookbook_recipe_versions` only stores prior
 * versions. So when a recipe is at v3, the versions table has v1 and v2;
 * v3 is the row itself.
 */
export interface RecipeVersionRecord {
  id: string;
  recipeId: string;
  version: number;
  subgraph: RecipeSubgraph;
  /** Snapshot of the name at this version (renames after the fact don't
   *  retroactively edit history). */
  name: string;
  description: string | null;
  category: RecipeCategory | null;
  /** auth.uid() of the user who saved this version (null for v1 created
   *  by a system migration; null also when the row predates RLS). */
  savedBy: string | null;
  createdAt: string;
}

export interface SaveRecipeInput {
  /** Provide to update an existing recipe; omit to insert a new one. */
  id?: string;
  /** Pass null to save as a system recipe (admin-only normally). */
  ownerId: string | null;
  name: string;
  description?: string | null;
  category?: RecipeCategory | null;
  subgraph: RecipeSubgraph;
  isNode?: boolean;
  parentRecipeId?: string | null;
}

/**
 * Phase B1 — input for the edit-and-save-as-new-version flow. Unlike
 * {@link SaveRecipeInput} (which inserts OR updates by id without any
 * version bookkeeping), this archives the prior version + bumps `version`
 * atomically via the `cookbook_save_as_new_version` Postgres RPC.
 *
 * `recipeId` is REQUIRED — there's no "save as new version" semantics for
 * a recipe that doesn't exist yet. Callers fork system recipes via
 * `forkRecipe()` first, then use this for subsequent edits.
 *
 * Optional name/description/category let the edit flow update metadata
 * alongside the subgraph; null/undefined keeps the prior value.
 */
export interface SaveAsNewVersionInput {
  recipeId: string;
  subgraph: RecipeSubgraph;
  name?: string | null;
  description?: string | null;
  category?: RecipeCategory | null;
}

export interface RecipeFilter {
  /** Whose recipes to include. */
  ownerId?: string | null;
  /** When true, also include system recipes (owner_id IS NULL). */
  includeSystem?: boolean;
  /** Filter by category (e.g. "image", "describe"). */
  category?: RecipeCategory;
  /** Soft cap. Defaults to 100. */
  limit?: number;
}

export interface RecipeRepository {
  list(filter: RecipeFilter): Promise<RecipeRecord[]>;
  get(id: string): Promise<RecipeRecord | null>;
  save(input: SaveRecipeInput): Promise<RecipeRecord>;
  remove(id: string): Promise<void>;
  /**
   * Phase B1 — atomically: snapshot the current `(subgraph, name, …)` of
   * `recipeId` into `cookbook_recipe_versions` AS the prior version,
   * then update `cookbook_recipes` with the new subgraph + bumped
   * version. Backed by the `cookbook_save_as_new_version` RPC.
   *
   * Returns the updated record (with the bumped `version`).
   */
  saveAsNewVersion(input: SaveAsNewVersionInput): Promise<RecipeRecord>;
  /**
   * Phase B1 — list every prior version of a recipe, descending by
   * version number (most recent edit first). The current version lives
   * on the `cookbook_recipes` row itself and is NOT included here.
   */
  listVersions(recipeId: string): Promise<RecipeVersionRecord[]>;
  /**
   * Phase B1 — fetch one specific historical version. Returns null if
   * the (recipeId, version) pair doesn't exist (e.g. asking for v2 of a
   * never-edited recipe).
   */
  getVersion(
    recipeId: string,
    version: number,
  ): Promise<RecipeVersionRecord | null>;
}

export class RecipeRepositoryError extends Error {
  readonly code:
    | "not_found"
    | "permission_denied"
    | "network"
    | "unknown";
  constructor(message: string, code: RecipeRepositoryError["code"]) {
    super(message);
    this.name = "RecipeRepositoryError";
    this.code = code;
  }
}
