import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * rename_node — Tier 1.5 (2026-06-03).
 *
 * Set a node's user-facing label. Empty / whitespace-only / null
 * clears the label so the header falls back to the schema title.
 * The store handles the trim + normalisation; we just relay.
 *
 * Useful when the assistant is building a structured workflow and
 * wants to label nodes by purpose ("System prompt", "Topic input",
 * "Final image") so the user can scan the canvas later.
 */

const argsSchema = z
  .object({
    nodeId: z.string().min(1),
    label: z.string().nullable(),
  })
  .strict();

export const renameNodeTool: AssistantTool = {
  name: "rename_node",
  description:
    "Set a node's user-facing label (the title shown in the node header). Pass label=null or empty string to clear and fall back to the schema title. The store trims whitespace.",
  parameters: {
    type: "object",
    properties: {
      nodeId: { type: "string" },
      label: {
        type: ["string", "null"],
        description:
          "New label. null / empty / whitespace-only clears and falls back to schema title.",
      },
    },
    required: ["nodeId", "label"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    if (!ws.nodes.find((n) => n.id === args.nodeId)) {
      return { ok: false, error: `No node with id ${args.nodeId}` };
    }
    ws.renameNode(args.nodeId, args.label ?? undefined);
    return { ok: true };
  },
};
