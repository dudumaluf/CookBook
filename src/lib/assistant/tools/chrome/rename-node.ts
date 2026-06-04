import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";
import { diffShallow } from "../construct/diff-config";

/**
 * rename_node — Tier 1.5 (2026-06-03) + post-write receipts.
 *
 * Set a node's user-facing label. Empty / whitespace-only / null
 * clears the label so the header falls back to the schema title.
 * The store handles the trim + normalisation; we just relay.
 *
 * Useful when the assistant is building a structured workflow and
 * wants to label nodes by purpose ("System prompt", "Topic input",
 * "Final image") so the user can scan the canvas later.
 *
 * Receipt: diff of `label` field. No-op (same label) returns ok:false
 * so the LLM stops claiming "renamed it" when nothing happened.
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
    "Set a node's user-facing label (the title shown in the node header). Pass label=null or empty string to clear and fall back to the schema title. Returns { changed: ['label'], before, after } on success; ok: false (no-op) when the label was already that value. Quote `after.label` verbatim before saying you renamed.",
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
    const node = ws.nodes.find((n) => n.id === args.nodeId);
    if (!node) {
      return { ok: false, error: `No node with id ${args.nodeId}` };
    }
    const beforeLabel = node.label ?? null;
    ws.renameNode(args.nodeId, args.label ?? undefined);
    const afterNode = useWorkflowStore.getState().nodes.find((n) => n.id === args.nodeId);
    const afterLabel = afterNode?.label ?? null;
    const { changed, pickedBefore, pickedAfter } = diffShallow(
      { label: beforeLabel },
      { label: afterLabel },
    );
    if (changed.length === 0) {
      return {
        ok: false,
        error:
          "no-op rename — label did not change (already had this value, or both before and after resolve to the schema fallback).",
        nodeId: args.nodeId,
        label: beforeLabel,
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
