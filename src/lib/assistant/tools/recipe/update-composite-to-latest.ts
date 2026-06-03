import { z } from "zod";

import {
  countCompositesByRecipe,
  updateAllCompositesByRecipe,
  updateCompositeInstance,
} from "@/lib/recipes/update-composite";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

import type { CompositeNodeConfig } from "@/components/nodes/node-composite";

/**
 * update_composite_to_latest — Tier 1.3 (2026-06-03).
 *
 * Bring a stale composite (or every composite of a given recipe) up
 * to the recipe row's current version. Mirrors the CompositeUpdate-
 * Badge popover the user sees on canvas, exposed to chat. The
 * underlying helpers (`updateCompositeInstance`,
 * `updateAllCompositesByRecipe`) preserve `exposedParams` overrides
 * by capturing them before the swap and re-applying after — drops
 * are reported in the response so the LLM can warn the user.
 *
 * Two argument shapes — XOR:
 *   - `{ nodeId: "<composite-on-canvas>" }` → update one instance.
 *   - `{ recipeId: "<recipe-uuid>" }` → update every composite in
 *     the current workflow that points at this recipe.
 *
 * Picking both at once is rejected by the Zod refinement so the
 * LLM can't accidentally fire double work.
 */

const argsSchema = z
  .object({
    nodeId: z.string().min(1).optional(),
    recipeId: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (a) => Boolean(a.nodeId) !== Boolean(a.recipeId),
    "Provide exactly one of nodeId or recipeId, not both.",
  );

export const updateCompositeToLatestTool: AssistantTool = {
  name: "update_composite_to_latest",
  description:
    "Update a stale composite node (or every composite of a recipe) to the recipe's current version. Pass exactly one of: { nodeId } for a single instance, { recipeId } for all instances in the current workflow. Preserves exposedParams overrides where possible; reports preserved/dropped counts.",
  parameters: {
    type: "object",
    properties: {
      nodeId: {
        type: "string",
        description: "Composite node id on the current canvas.",
      },
      recipeId: {
        type: "string",
        description:
          "Update every composite in the current workflow that points at this recipe id.",
      },
    },
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    if (args.nodeId) {
      // Single-instance path. Pre-validate kind before calling so the
      // LLM gets a useful error instead of a generic ok:false from
      // the helper's defensive guard.
      const node = useWorkflowStore
        .getState()
        .nodes.find((n) => n.id === args.nodeId);
      if (!node) {
        return { ok: false, error: `No node with id ${args.nodeId}` };
      }
      if (node.kind !== "composite") {
        return {
          ok: false,
          error: `Node ${args.nodeId} is kind '${node.kind}', not 'composite'.`,
        };
      }
      const cfg = node.config as CompositeNodeConfig;
      if (!cfg.recipeId) {
        return {
          ok: false,
          error: `Composite ${args.nodeId} was saved without a cloud recipe row — nothing to update against.`,
        };
      }
      const r = await updateCompositeInstance({ nodeId: args.nodeId });
      return {
        ok: r.ok,
        updatedCount: r.ok ? 1 : 0,
        preservedOverrides: r.preservedOverrides,
        droppedOverrides: r.droppedOverrides,
      };
    }
    const recipeId = args.recipeId!;
    const total = countCompositesByRecipe(recipeId);
    const r = await updateAllCompositesByRecipe({ recipeId });
    return {
      ok: r.ok,
      totalInstances: total,
      updatedCount: r.updatedCount,
      preservedOverrides: r.preservedOverrides,
      droppedOverrides: r.droppedOverrides,
    };
  },
};
