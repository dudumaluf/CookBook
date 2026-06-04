import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";
import { diffShallow } from "./diff-config";

/**
 * move_node — Slice 7.3 + post-write receipts (2026-06-03).
 *
 * Receipt: shallow diff of `position`. If the requested coords
 * already match the current ones we return ok:false (no-op) so the
 * LLM doesn't fabricate a move.
 */

const argsSchema = z
  .object({
    nodeId: z.string().min(1),
    position: z.object({ x: z.number(), y: z.number() }),
  })
  .strict();

export const moveNodeTool: AssistantTool = {
  name: "move_node",
  description:
    "Move a node to a new canvas position. Use to reorganize cluttered graphs into a clean topological flow (left-to-right or top-to-bottom). Returns { changed: ['x'|'y'|...], before, after } when the position actually changed; ok: false (no-op) when the requested coords match the current position.",
  parameters: {
    type: "object",
    properties: {
      nodeId: { type: "string" },
      position: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
        additionalProperties: false,
      },
    },
    required: ["nodeId", "position"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    const node = ws.nodes.find((n) => n.id === args.nodeId);
    if (!node) {
      return { ok: false, error: `No node with id ${args.nodeId}` };
    }
    const before = { x: node.position.x, y: node.position.y };
    ws.moveNode(args.nodeId, args.position);
    const after = useWorkflowStore.getState().nodes.find((n) => n.id === args.nodeId)?.position ?? before;
    const { changed, pickedBefore, pickedAfter } = diffShallow(before, after);
    if (changed.length === 0) {
      return {
        ok: false,
        error:
          "no-op move — position did not change. The requested coords matched the current ones.",
        nodeId: args.nodeId,
        position: before,
      };
    }
    return {
      ok: true,
      nodeId: args.nodeId,
      changed,
      before: pickedBefore,
      after: pickedAfter,
    };
  },
};
