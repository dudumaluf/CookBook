import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * resize_node — Tier 1.5 (2026-06-03).
 *
 * Persist user-set dimensions for a node. Pass `width` / `height`
 * in pixels — the store rounds to integers and normalises an
 * all-undefined size to no size at all. Pass `clear: true` to wipe
 * the persisted size so the node falls back to its schema default.
 *
 * The schema's `defaultWidth` + `minWidth` / `maxWidth` are still
 * enforced at render time; the store doesn't validate against them.
 * That's deliberate — the schema may change between sessions and
 * a forward-port could squeeze a too-large persisted size to fit.
 */

const argsSchema = z
  .object({
    nodeId: z.string().min(1),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    clear: z.boolean().optional(),
  })
  .strict()
  .refine(
    (a) =>
      a.clear === true ||
      a.width !== undefined ||
      a.height !== undefined,
    "Provide at least one of width / height, or clear=true.",
  );

export const resizeNodeTool: AssistantTool = {
  name: "resize_node",
  description:
    "Persist user-set width/height for a node (pixels). Pass clear=true to drop the persisted size and fall back to the schema default. Schema min/max constraints are enforced at render time.",
  parameters: {
    type: "object",
    properties: {
      nodeId: { type: "string" },
      width: {
        type: "number",
        description: "Pixels. Optional — omit to keep current width.",
      },
      height: {
        type: "number",
        description: "Pixels. Optional — omit to keep current height.",
      },
      clear: {
        type: "boolean",
        description: "Wipe persisted size; fall back to schema default.",
      },
    },
    required: ["nodeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    if (!ws.nodes.find((n) => n.id === args.nodeId)) {
      return { ok: false, error: `No node with id ${args.nodeId}` };
    }
    if (args.clear) {
      ws.resizeNode(args.nodeId, undefined);
      return { ok: true, cleared: true };
    }
    ws.resizeNode(args.nodeId, {
      ...(args.width !== undefined ? { width: args.width } : {}),
      ...(args.height !== undefined ? { height: args.height } : {}),
    });
    return { ok: true, cleared: false };
  },
};
