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
 * subgraph. Updates are rare; sharing is M2.
 */

export interface RecipeSubgraph {
  /** Version tag — bumped when the subgraph shape changes. */
  version: number;
  nodes: NodeInstance[];
  edges: WorkflowEdge[];
  /**
   * When `is_node === true` (M0d composite mode), these declare which
   * internal handles surface as the composite's external pins. Empty /
   * undefined when instantiating expands the subgraph as raw nodes.
   */
  exposedInputs?: {
    internalNodeId: string;
    internalHandleId: string;
    label: string;
    dataType: string;
  }[];
  exposedOutputs?: {
    internalNodeId: string;
    internalHandleId: string;
    label: string;
    dataType: string;
  }[];
}

export const RECIPE_SUBGRAPH_VERSION = 1;

export interface RecipeRecord {
  id: string;
  /** null = system recipe (visible to everyone). */
  ownerId: string | null;
  name: string;
  description: string | null;
  category: string | null;
  subgraph: RecipeSubgraph;
  isNode: boolean;
  parentRecipeId: string | null;
  createdAt: string;
}

export interface SaveRecipeInput {
  /** Provide to update an existing recipe; omit to insert a new one. */
  id?: string;
  /** Pass null to save as a system recipe (admin-only normally). */
  ownerId: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  subgraph: RecipeSubgraph;
  isNode?: boolean;
  parentRecipeId?: string | null;
}

export interface RecipeFilter {
  /** Whose recipes to include. */
  ownerId?: string | null;
  /** When true, also include system recipes (owner_id IS NULL). */
  includeSystem?: boolean;
  /** Filter by category (e.g. "image", "describe"). */
  category?: string;
  /** Soft cap. Defaults to 100. */
  limit?: number;
}

export interface RecipeRepository {
  list(filter: RecipeFilter): Promise<RecipeRecord[]>;
  get(id: string): Promise<RecipeRecord | null>;
  save(input: SaveRecipeInput): Promise<RecipeRecord>;
  remove(id: string): Promise<void>;
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
