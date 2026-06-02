import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import type {
  RecipeRecord,
  RecipeSubgraph,
} from "@/lib/repositories/recipe-repository";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type {
  CompositeNodeConfig,
} from "@/components/nodes/node-composite";
import type { NodeInstance } from "@/types/node";

/**
 * Composite-instance updater — Cookbook Library Phase B2 (ADR-0060).
 *
 * Replaces the embedded `subgraph` + bumps the `recipeVersion` on a
 * stale composite node so it tracks the recipe's latest version. Two
 * entry points: one for a single instance, one for every instance of a
 * given recipe in the current project.
 *
 * Override preservation:
 *   The composite exposes `exposedParams` as inline controls. When the
 *   user edits one, the new value is written into the embedded
 *   `subgraph.nodes[*].config[configKey]`. A naive `subgraph =
 *   newSubgraph` would wipe those tweaks. We capture them BEFORE the
 *   replace and re-apply AFTER — only when the matching `internalNodeId`
 *   still exists in the new subgraph (otherwise the override is dropped
 *   with a warning callback so the caller can toast).
 */

export type OverrideMap = Map<string, Record<string, unknown>>;

export interface UpdateInstanceResult {
  ok: boolean;
  /** Number of overrides successfully re-applied. */
  preservedOverrides: number;
  /** Number of overrides that had to be dropped because the inner node
   *  is gone in the new subgraph. */
  droppedOverrides: number;
}

export function captureExposedOverrides(
  config: CompositeNodeConfig,
): OverrideMap {
  const out: OverrideMap = new Map();
  const params = config.exposedParams ?? [];
  const innerById = new Map(config.subgraph.nodes.map((n) => [n.id, n]));
  for (const p of params) {
    const inner = innerById.get(p.internalNodeId);
    if (!inner) continue;
    const innerCfg = (inner.config ?? {}) as Record<string, unknown>;
    if (!(p.configKey in innerCfg)) continue;
    const existing = out.get(p.internalNodeId) ?? {};
    existing[p.configKey] = innerCfg[p.configKey];
    out.set(p.internalNodeId, existing);
  }
  return out;
}

export interface ApplyOverridesResult {
  subgraph: RecipeSubgraph;
  preserved: number;
  dropped: number;
}

export function applyExposedOverrides(
  newSubgraph: RecipeSubgraph,
  overrides: OverrideMap,
): ApplyOverridesResult {
  const newNodesById = new Set(newSubgraph.nodes.map((n) => n.id));
  let preserved = 0;
  const nodes = newSubgraph.nodes.map((n) => {
    const o = overrides.get(n.id);
    if (!o) return n;
    preserved += Object.keys(o).length;
    return { ...n, config: { ...(n.config as object), ...o } };
  });
  // Drops = override entries whose target inner node no longer exists
  // in the new subgraph (the recipe edit removed it). Surfaced to the
  // caller so it can toast a warning.
  let dropped = 0;
  for (const [id, fields] of overrides) {
    if (!newNodesById.has(id)) dropped += Object.keys(fields).length;
  }
  return {
    subgraph: { ...newSubgraph, nodes },
    preserved,
    dropped,
  };
}

async function fetchAndPrepareRecipe(recipeId: string): Promise<RecipeRecord | null> {
  return getRecipeRepository().get(recipeId);
}

/**
 * Update a single composite node to track the recipe's latest version.
 * Returns counters so the caller can toast "Updated; X overrides
 * preserved, Y dropped".
 */
export async function updateCompositeInstance(args: {
  nodeId: string;
}): Promise<UpdateInstanceResult> {
  const { nodeId } = args;
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node || node.kind !== "composite") {
    return { ok: false, preservedOverrides: 0, droppedOverrides: 0 };
  }
  const config = node.config as CompositeNodeConfig;
  if (!config.recipeId) {
    return { ok: false, preservedOverrides: 0, droppedOverrides: 0 };
  }
  const recipe = await fetchAndPrepareRecipe(config.recipeId);
  if (!recipe) {
    return { ok: false, preservedOverrides: 0, droppedOverrides: 0 };
  }
  const overrides = captureExposedOverrides(config);
  const { subgraph, preserved, dropped } = applyExposedOverrides(
    recipe.subgraph,
    overrides,
  );
  useWorkflowStore.getState().updateNodeConfig<CompositeNodeConfig>(nodeId, {
    recipeName: recipe.name,
    recipeVersion: recipe.version,
    subgraph,
    exposedInputs: recipe.subgraph.exposedInputs ?? [],
    exposedOutputs: recipe.subgraph.exposedOutputs ?? [],
    exposedParams: recipe.subgraph.exposedParams ?? [],
  });
  return {
    ok: true,
    preservedOverrides: preserved,
    droppedOverrides: dropped,
  };
}

/**
 * Update every composite in the current project that points at the
 * given recipe. Useful for "I just edited recipe X — bring all my N
 * instances up to v(latest)".
 */
export interface UpdateAllResult {
  ok: boolean;
  updatedCount: number;
  preservedOverrides: number;
  droppedOverrides: number;
}

export async function updateAllCompositesByRecipe(args: {
  recipeId: string;
}): Promise<UpdateAllResult> {
  const { recipeId } = args;
  const recipe = await fetchAndPrepareRecipe(recipeId);
  if (!recipe) {
    return {
      ok: false,
      updatedCount: 0,
      preservedOverrides: 0,
      droppedOverrides: 0,
    };
  }
  // One pass to collect targets so a render between captures + writes
  // doesn't see partial state. (`findStaleInstances` reads workflow-
  // store atomically.)
  const stale = findStaleInstances(recipeId, recipe.version);
  if (stale.length === 0) {
    return {
      ok: true,
      updatedCount: 0,
      preservedOverrides: 0,
      droppedOverrides: 0,
    };
  }
  let preservedTotal = 0;
  let droppedTotal = 0;
  // Build the next nodes array in one shot — single setState, single
  // render, no intermediate reactive flushes.
  const updates = new Map<string, CompositeNodeConfig>();
  for (const node of stale) {
    const cfg = node.config as CompositeNodeConfig;
    const overrides = captureExposedOverrides(cfg);
    const { subgraph, preserved, dropped } = applyExposedOverrides(
      recipe.subgraph,
      overrides,
    );
    preservedTotal += preserved;
    droppedTotal += dropped;
    updates.set(node.id, {
      ...cfg,
      recipeName: recipe.name,
      recipeVersion: recipe.version,
      subgraph,
      exposedInputs: recipe.subgraph.exposedInputs ?? [],
      exposedOutputs: recipe.subgraph.exposedOutputs ?? [],
      exposedParams: recipe.subgraph.exposedParams ?? [],
    });
  }
  useWorkflowStore.setState((state) => ({
    nodes: state.nodes.map((n) =>
      updates.has(n.id) ? { ...n, config: updates.get(n.id) } : n,
    ),
  }));
  return {
    ok: true,
    updatedCount: stale.length,
    preservedOverrides: preservedTotal,
    droppedOverrides: droppedTotal,
  };
}

/** Return composites in the current workflow that are stale relative to
 *  `currentVersion`. Used internally + by tests. */
export function findStaleInstances(
  recipeId: string,
  currentVersion: number,
): NodeInstance[] {
  return useWorkflowStore.getState().nodes.filter((n) => {
    if (n.kind !== "composite") return false;
    const cfg = n.config as CompositeNodeConfig;
    if (cfg.recipeId !== recipeId) return false;
    if (cfg.recipeVersion === null) return false;
    return cfg.recipeVersion < currentVersion;
  });
}

/** How many composites in the current workflow point at this recipe?
 *  (Includes both stale + up-to-date.) Used by the badge popover to
 *  show "Update all 3 instances of this recipe in this project" —
 *  the count in that label means stale + this-instance combined. */
export function countCompositesByRecipe(recipeId: string): number {
  return useWorkflowStore.getState().nodes.filter((n) => {
    if (n.kind !== "composite") return false;
    const cfg = n.config as CompositeNodeConfig;
    return cfg.recipeId === recipeId;
  }).length;
}
