import { z } from "zod";

import { instantiateRecipeOnCanvas } from "@/lib/recipes/instantiate";
import { getRecipeRepository } from "@/lib/repositories/supabase-recipe-repository";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * instantiate_recipe — Slice 7.3 (ADR-0042) + ADR-0069 F20 bindings.
 *
 * Drop a saved recipe onto the canvas. Two modes:
 *   - mode: "node" (default for is_node:true recipes) — spawns a
 *     single composite node carrying the captured subgraph in its
 *     config. The composite renders only the recipe's exposed I/O.
 *   - mode: "expand" (default for is_node:false recipes) — instantiates
 *     the recipe as raw nodes on canvas. The user can then edit each
 *     internal node directly.
 *
 * If `mode` is omitted, the tool follows the recipe's `isNode` flag.
 *
 * ADR-0069 F20 — `bindings` (optional). Wire the recipe's exposed
 * inputs to upstream nodes IN THE SAME TOOL CALL so the LLM doesn't
 * have to chain `instantiate_recipe` → `read_node_state` → N×
 * `add_edge`. Each binding pairs an exposed-input label with an
 * upstream `{ nodeId, handle }`. Type compatibility is checked the
 * same way `add_edge` checks it; failures are reported per-binding
 * in `wireFailures` and the recipe still drops onto the canvas
 * (better than silently throwing away the spawn).
 *
 * Bindings work in BOTH modes:
 *   - "node" mode: the binding's `exposedInputId` IS the composite
 *     node's input handle id (composites use the exposed label as
 *     the handle id).
 *   - "expand" mode: the binding's `exposedInputId` resolves to the
 *     recipe's `RecipeExposedHandle` entry, which points at the
 *     `internalNodeId` + `internalHandleId` — and we translate the
 *     internal id through the spawn's id map to find the live
 *     target.
 */

const argsSchema = z
  .object({
    recipeId: z.string().min(1),
    position: z
      .object({ x: z.number(), y: z.number() })
      .default({ x: 200, y: 200 }),
    mode: z.enum(["node", "expand"]).optional(),
    bindings: z
      .array(
        z
          .object({
            exposedInputId: z.string().min(1),
            from: z
              .object({
                nodeId: z.string().min(1),
                handle: z.string().min(1),
              })
              .strict(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

interface BindingResult {
  exposedInputId: string;
  ok: boolean;
  edgeId?: string;
  error?: string;
}

export const instantiateRecipeTool: AssistantTool = {
  name: "instantiate_recipe",
  description:
    "Drop a saved recipe onto the canvas. Mode 'node' spawns a single composite node (one box with the recipe's exposed I/O); mode 'expand' instantiates all the inner nodes directly. Defaults to the recipe's saved isNode flag. Optional `bindings` wire the recipe's exposed inputs to upstream nodes in the same call — each binding is `{ exposedInputId, from: { nodeId, handle } }`. Returns `{ ok, mode, ...spawn details, wireSummary }` where wireSummary contains per-binding success/failure.",
  parameters: {
    type: "object",
    properties: {
      recipeId: { type: "string" },
      position: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
        additionalProperties: false,
      },
      mode: {
        type: "string",
        enum: ["node", "expand"],
        description:
          "'node' = composite (one box). 'expand' = raw nodes. Default: follow recipe.isNode.",
      },
      bindings: {
        type: "array",
        description:
          "Optional. Wire upstream nodes to the recipe's exposed inputs in the same call. Each entry: { exposedInputId, from: { nodeId, handle } }. Skipped silently when empty.",
        items: {
          type: "object",
          properties: {
            exposedInputId: {
              type: "string",
              description:
                "Exposed input label of the recipe (matches recipe.subgraph.exposedInputs[*].label).",
            },
            from: {
              type: "object",
              properties: {
                nodeId: { type: "string" },
                handle: { type: "string" },
              },
              required: ["nodeId", "handle"],
              additionalProperties: false,
            },
          },
          required: ["exposedInputId", "from"],
          additionalProperties: false,
        },
      },
    },
    required: ["recipeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const recipe = await getRecipeRepository().get(args.recipeId);
    if (!recipe) {
      return { ok: false, error: `No recipe with id ${args.recipeId}` };
    }
    const mode = args.mode ?? (recipe.isNode ? "node" : "expand");
    const bindings = args.bindings ?? [];

    if (mode === "node") {
      const id = useWorkflowStore.getState().addNode(
        "composite",
        args.position,
        {
          recipeId: recipe.id,
          recipeName: recipe.name,
          recipeVersion: recipe.version,
          subgraph: recipe.subgraph,
          exposedInputs: recipe.subgraph.exposedInputs ?? [],
          exposedOutputs: recipe.subgraph.exposedOutputs ?? [],
        },
      );
      const wireSummary = bindings.map((b) =>
        wireToCompositeInput({
          compositeNodeId: id,
          exposedInputId: b.exposedInputId,
          from: b.from,
          recipe,
        }),
      );
      return {
        ok: wireSummary.every((w) => w.ok),
        mode,
        compositeNodeId: id,
        changed: ["__create"],
        entity: {
          id,
          kind: "composite",
          recipeId: recipe.id,
          recipeName: recipe.name,
          recipeVersion: recipe.version,
        },
        wireSummary,
        wireFailures: wireSummary.filter((w) => !w.ok),
      };
    }
    const result = instantiateRecipeOnCanvas({
      subgraph: recipe.subgraph,
      position: args.position,
    });
    const wireSummary = bindings.map((b) =>
      wireToExpandedInput({
        idMap: result.idMap,
        exposedInputId: b.exposedInputId,
        from: b.from,
        recipe,
      }),
    );
    return {
      ok: wireSummary.every((w) => w.ok),
      mode,
      spawnedNodeIds: result.nodeIds,
      changed: ["__bulk"],
      bulk: {
        recipeId: recipe.id,
        recipeName: recipe.name,
        recipeVersion: recipe.version,
        spawnedNodeCount: result.nodeIds.length,
      },
      wireSummary,
      wireFailures: wireSummary.filter((w) => !w.ok),
    };
  },
};

/**
 * Wire `from.nodeId.handle` into the composite's exposed input. The
 * composite uses the exposed input's `label` as its input handle id,
 * so we just need to verify the label exists and call addEdge.
 */
function wireToCompositeInput(args: {
  compositeNodeId: string;
  exposedInputId: string;
  from: { nodeId: string; handle: string };
  recipe: {
    subgraph: {
      exposedInputs?: Array<{ label: string; dataType: string }>;
    };
  };
}): BindingResult {
  const exposed = (args.recipe.subgraph.exposedInputs ?? []).find(
    (e) => e.label === args.exposedInputId,
  );
  if (!exposed) {
    return {
      exposedInputId: args.exposedInputId,
      ok: false,
      error: `No exposed input named "${args.exposedInputId}" on this recipe.`,
    };
  }
  const ws = useWorkflowStore.getState();
  if (!ws.nodes.find((n) => n.id === args.from.nodeId)) {
    return {
      exposedInputId: args.exposedInputId,
      ok: false,
      error: `Upstream node ${args.from.nodeId} not on canvas.`,
    };
  }
  const edgeId = ws.addEdge({
    source: args.from.nodeId,
    sourceHandle: args.from.handle,
    target: args.compositeNodeId,
    targetHandle: args.exposedInputId,
  });
  if (!edgeId) {
    return {
      exposedInputId: args.exposedInputId,
      ok: false,
      error: "Edge rejected by store (self-loop, duplicate, or capacity).",
    };
  }
  return { exposedInputId: args.exposedInputId, ok: true, edgeId };
}

/**
 * Wire `from.nodeId.handle` into the expanded recipe's internal node
 * + handle that the exposed input points at. Resolves the saved
 * internalNodeId through the spawn's idMap so the wire targets the
 * fresh live node.
 */
function wireToExpandedInput(args: {
  idMap: Map<string, string>;
  exposedInputId: string;
  from: { nodeId: string; handle: string };
  recipe: {
    subgraph: {
      exposedInputs?: Array<{
        label: string;
        internalNodeId: string;
        internalHandleId: string;
      }>;
    };
  };
}): BindingResult {
  const exposed = (args.recipe.subgraph.exposedInputs ?? []).find(
    (e) => e.label === args.exposedInputId,
  );
  if (!exposed) {
    return {
      exposedInputId: args.exposedInputId,
      ok: false,
      error: `No exposed input named "${args.exposedInputId}" on this recipe.`,
    };
  }
  const liveTargetId = args.idMap.get(exposed.internalNodeId);
  if (!liveTargetId) {
    return {
      exposedInputId: args.exposedInputId,
      ok: false,
      error: `Could not resolve internal node ${exposed.internalNodeId} in expanded subgraph.`,
    };
  }
  const ws = useWorkflowStore.getState();
  if (!ws.nodes.find((n) => n.id === args.from.nodeId)) {
    return {
      exposedInputId: args.exposedInputId,
      ok: false,
      error: `Upstream node ${args.from.nodeId} not on canvas.`,
    };
  }
  const edgeId = ws.addEdge({
    source: args.from.nodeId,
    sourceHandle: args.from.handle,
    target: liveTargetId,
    targetHandle: exposed.internalHandleId,
  });
  if (!edgeId) {
    return {
      exposedInputId: args.exposedInputId,
      ok: false,
      error: "Edge rejected by store (self-loop, duplicate, or capacity).",
    };
  }
  return { exposedInputId: args.exposedInputId, ok: true, edgeId };
}
