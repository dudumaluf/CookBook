import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * select_nodes — replaces the canvas selection.
 *
 * ADR-0069 F16: filters out ids that don't exist on the canvas
 * before applying the selection, and returns `missingIds` so the
 * LLM can recognise the discrepancy on the spot. Without this the
 * store happily accepted phantom ids — the FOCUSED NODE block then
 * showed nothing, downstream `update_node_config` returned "no
 * such node", and the LLM blamed itself / the user.
 */

const argsSchema = z
  .object({
    nodeIds: z.array(z.string().min(1)),
  })
  .strict();

export const selectNodesTool: AssistantTool = {
  name: "select_nodes",
  description:
    "Replace the canvas selection with the given node ids. Filters out ids that aren't on the canvas; returns `{ ok, selectedCount, selectedIds, missingIds }`. If `missingIds` is non-empty, surface it to the user instead of pretending the selection is what was requested.",
  parameters: {
    type: "object",
    properties: {
      nodeIds: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["nodeIds"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    const existing = new Set(ws.nodes.map((n) => n.id));
    const selectedIds: string[] = [];
    const missingIds: string[] = [];
    // Preserve LLM-supplied order + dedupe, since downstream
    // consumers (e.g. ## SELECTION block) treat the array as the
    // user's preferred order.
    const seen = new Set<string>();
    for (const id of args.nodeIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (existing.has(id)) {
        selectedIds.push(id);
      } else {
        missingIds.push(id);
      }
    }
    ws.setSelectedNodeIds(selectedIds);
    return {
      ok: missingIds.length === 0,
      selectedCount: selectedIds.length,
      selectedIds,
      missingIds,
      ...(missingIds.length > 0
        ? {
            error: `Some node ids do not exist on canvas: ${missingIds.join(", ")}. Selection applied for the valid ones only — verify the canvas before claiming success.`,
          }
        : {}),
    };
  },
};
