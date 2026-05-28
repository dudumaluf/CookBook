import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import type {
  RecipeExposedHandle,
  RecipeRecord,
  RecipeSubgraph,
} from "@/lib/repositories/recipe-repository";
import { RECIPE_SUBGRAPH_VERSION } from "@/lib/repositories/recipe-repository";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * Save-from-canvas — Slice 6.6.
 *
 * Captures the user's currently-selected nodes (and the edges
 * connecting them) as a recipe row, optionally collapsing the
 * selection on canvas into a single composite node placed at the
 * selection's centroid.
 *
 * Three steps:
 *
 *   1. Slice the workflow-store: keep only the selected node ids and
 *      any edge whose endpoints are both inside the selection.
 *   2. Persist the recipe row via `RecipeRepository.save`.
 *   3. (Optional, default ON) Replace the selected nodes + their
 *      internal edges with a single `composite` node that points at
 *      the saved recipe. Edges that crossed the selection boundary
 *      get rewired to land on the composite's exposed handles. Edges
 *      that lived entirely outside the selection are untouched.
 *
 * The user immediately sees the result on canvas: their N nodes
 * collapse into one labeled composite node, and the surrounding
 * graph is preserved (re-wired to the composite's handles).
 */

export interface SaveFromCanvasInput {
  ownerId: string;
  selectedNodeIds: string[];
  exposedInputs: RecipeExposedHandle[];
  exposedOutputs: RecipeExposedHandle[];
  name: string;
  description?: string;
  category?: string;
  /** When true (default), the canvas selection is replaced with one
   *  composite node at the centroid of the selection. */
  replaceWithComposite?: boolean;
}

export interface SaveFromCanvasResult {
  recipe: RecipeRecord;
  /** ID of the composite node spawned on canvas, when
   *  `replaceWithComposite` was true. */
  compositeNodeId?: string;
}

function makeId(): string {
  return `node_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

export async function saveSelectionAsRecipe(
  input: SaveFromCanvasInput,
): Promise<SaveFromCanvasResult> {
  const ws = useWorkflowStore.getState();
  const allNodes = ws.nodes;
  const allEdges = ws.edges;
  const selectedSet = new Set(input.selectedNodeIds);

  const selectedNodes = allNodes.filter((n) => selectedSet.has(n.id));
  if (selectedNodes.length === 0) {
    throw new Error("Cannot save empty selection as recipe");
  }

  // Edges inside the selection — these go INTO the recipe's subgraph.
  const internalEdges = allEdges.filter(
    (e) => selectedSet.has(e.source) && selectedSet.has(e.target),
  );

  // Edges that crossed the selection boundary — these need re-wiring
  // when we collapse to a composite. Capture before mutation.
  const incomingEdges = allEdges.filter(
    (e) => !selectedSet.has(e.source) && selectedSet.has(e.target),
  );
  const outgoingEdges = allEdges.filter(
    (e) => selectedSet.has(e.source) && !selectedSet.has(e.target),
  );

  // Anchor the spawned composite at the selection centroid so the user
  // doesn't lose visual context.
  const centroid = (() => {
    if (selectedNodes.length === 0) return { x: 0, y: 0 };
    const sum = selectedNodes.reduce(
      (acc, n) => ({ x: acc.x + n.position.x, y: acc.y + n.position.y }),
      { x: 0, y: 0 },
    );
    return {
      x: Math.round(sum.x / selectedNodes.length),
      y: Math.round(sum.y / selectedNodes.length),
    };
  })();

  const subgraph: RecipeSubgraph = {
    version: RECIPE_SUBGRAPH_VERSION,
    nodes: selectedNodes,
    edges: internalEdges,
    exposedInputs: input.exposedInputs,
    exposedOutputs: input.exposedOutputs,
  };

  // 2. Persist the recipe row.
  const repo = getRecipeRepository();
  const recipe = await repo.save({
    ownerId: input.ownerId,
    name: input.name,
    description: input.description,
    category: input.category,
    subgraph,
    isNode: true,
  });

  // 3. (Optional) Replace selection with composite.
  if (input.replaceWithComposite === false) {
    return { recipe };
  }

  // Build the composite node instance.
  const compositeId = makeId();
  // Map the OLD selected node id → composite NEW node id, so we can
  // rewire crossing edges to land on the composite using the matching
  // exposed-handle label (which equals the public handle id).
  const exposedInByInternal = new Map<string, RecipeExposedHandle>();
  for (const h of input.exposedInputs) {
    exposedInByInternal.set(
      `${h.internalNodeId}::${h.internalHandleId}`,
      h,
    );
  }
  const exposedOutByInternal = new Map<string, RecipeExposedHandle>();
  for (const h of input.exposedOutputs) {
    exposedOutByInternal.set(
      `${h.internalNodeId}::${h.internalHandleId}`,
      h,
    );
  }

  const compositeNode = {
    id: compositeId,
    kind: "composite",
    position: centroid,
    config: {
      recipeId: recipe.id,
      recipeName: recipe.name,
      subgraph,
      exposedInputs: input.exposedInputs,
      exposedOutputs: input.exposedOutputs,
    },
  };

  // Rewire crossing edges. Drop the ones whose exposed mapping isn't
  // declared (edge crossed boundary into a handle the user didn't
  // expose — surface area mismatch; safer to drop than to silently
  // mis-route).
  const rewiredIncoming = incomingEdges
    .map((e) => {
      const exposed = exposedInByInternal.get(`${e.target}::${e.targetHandle}`);
      if (!exposed) return null;
      return {
        ...e,
        id: makeId(),
        target: compositeId,
        targetHandle: exposed.label,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const rewiredOutgoing = outgoingEdges
    .map((e) => {
      const exposed = exposedOutByInternal.get(
        `${e.source}::${e.sourceHandle}`,
      );
      if (!exposed) return null;
      return {
        ...e,
        id: makeId(),
        source: compositeId,
        sourceHandle: exposed.label,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  // Atomic mutation: drop the selected nodes + their edges + the
  // crossing edges, then add the composite + rewired edges.
  useWorkflowStore.setState((state) => {
    const remainingNodes = state.nodes.filter((n) => !selectedSet.has(n.id));
    const remainingEdges = state.edges.filter(
      (e) =>
        !selectedSet.has(e.source) &&
        !selectedSet.has(e.target),
    );
    return {
      nodes: [...remainingNodes, compositeNode as never],
      edges: [...remainingEdges, ...rewiredIncoming, ...rewiredOutgoing],
      selectedNodeIds: [compositeId],
      selectedEdgeIds: [],
    };
  });

  return { recipe, compositeNodeId: compositeId };
}
