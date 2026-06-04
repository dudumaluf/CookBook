import { z } from "zod";

import { autoDetectExposedIO } from "@/lib/recipes/auto-detect-io";
import { saveSelectionAsRecipe } from "@/lib/recipes/save-from-canvas";
import { RECIPE_CATEGORIES } from "@/lib/repositories/recipe-repository";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * save_selection_as_recipe — Slice 7.3 (ADR-0042).
 *
 * Capture the user's currently-selected nodes as a recipe row + (by
 * default) collapse the selection to a single composite node. Returns
 * the new recipe id + the composite node id.
 *
 * The auto-detect step picks dangling/escaping handles as the public
 * surface — same logic the Save-as-recipe modal uses. The LLM can
 * override by passing `exposedInputs` / `exposedOutputs` explicitly.
 *
 * 2026-06-04 — `category` is now validated against `RECIPE_CATEGORIES`
 * (`describe` / `image` / `video` / `audio` / `utility`). Defaults to
 * `utility` when the LLM doesn't pick one. The Add Node menu groups
 * recipes by this field, so an unbucketed recipe is hard to find.
 */

const exposedHandleSchema = z.object({
  internalNodeId: z.string().min(1),
  internalHandleId: z.string().min(1),
  label: z.string().min(1),
  dataType: z.string().min(1),
});

const argsSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    category: z.enum(RECIPE_CATEGORIES).optional(),
    selectedNodeIds: z.array(z.string()).optional(),
    exposedInputs: z.array(exposedHandleSchema).optional(),
    exposedOutputs: z.array(exposedHandleSchema).optional(),
    replaceWithComposite: z.boolean().optional(),
  })
  .strict();

export const saveSelectionAsRecipeTool: AssistantTool = {
  name: "save_selection_as_recipe",
  description:
    "Save the current canvas selection (or the explicit `selectedNodeIds`) as a reusable recipe. By default collapses the selection into a single composite node at its centroid. Auto-detects exposed I/O if you don't pass explicit lists. Pass `category` to bucket the recipe in the Add Node menu (describe / image / video / audio / utility); defaults to 'utility'.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      category: {
        type: "string",
        enum: [...RECIPE_CATEGORIES],
        description:
          "One of describe / image / video / audio / utility. Buckets the recipe in the Add Node menu. Pick `describe` for text-output prompt directors, `image`/`video`/`audio` by primary OUTPUT modality, `utility` for cross-modal scaffolding. Defaults to 'utility' when omitted.",
      },
      selectedNodeIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Override the live selection. When omitted, uses workflow-store.selectedNodeIds.",
      },
      exposedInputs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            internalNodeId: { type: "string" },
            internalHandleId: { type: "string" },
            label: { type: "string" },
            dataType: { type: "string" },
          },
          required: [
            "internalNodeId",
            "internalHandleId",
            "label",
            "dataType",
          ],
          additionalProperties: false,
        },
      },
      exposedOutputs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            internalNodeId: { type: "string" },
            internalHandleId: { type: "string" },
            label: { type: "string" },
            dataType: { type: "string" },
          },
          required: [
            "internalNodeId",
            "internalHandleId",
            "label",
            "dataType",
          ],
          additionalProperties: false,
        },
      },
      replaceWithComposite: {
        type: "boolean",
        description:
          "Default true — collapses the selection into a single composite node. Set false to keep the raw nodes on canvas + only persist the recipe.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    if (!ctx.ownerId) {
      return { ok: false, error: "no authenticated user" };
    }
    const args = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    const selectedIds = args.selectedNodeIds ?? ws.selectedNodeIds;
    if (selectedIds.length === 0) {
      return {
        ok: false,
        error:
          "Selection is empty. Use select_nodes first or pass `selectedNodeIds` explicitly.",
      };
    }
    const selectedNodes = ws.nodes.filter((n) =>
      selectedIds.includes(n.id),
    );
    let exposedInputs = args.exposedInputs;
    let exposedOutputs = args.exposedOutputs;
    if (!exposedInputs || !exposedOutputs) {
      const detected = autoDetectExposedIO(selectedNodes, ws.edges);
      exposedInputs = exposedInputs ?? detected.inputs;
      exposedOutputs = exposedOutputs ?? detected.outputs;
    }
    const result = await saveSelectionAsRecipe({
      ownerId: ctx.ownerId,
      selectedNodeIds: selectedIds,
      name: args.name,
      description: args.description,
      category: args.category ?? "utility",
      exposedInputs,
      exposedOutputs,
      replaceWithComposite: args.replaceWithComposite ?? true,
    });
    return {
      ok: true,
      recipeId: result.recipe.id,
      compositeNodeId: result.compositeNodeId,
      category: result.recipe.category,
    };
  },
};
