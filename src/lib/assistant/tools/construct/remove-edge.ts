import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";
import { snapshotEdge } from "./diff-config";

/**
 * remove_edge — Slice 7.3 + post-write receipts (2026-06-03).
 *
 * Returns ok:false when the edge id doesn't exist so the LLM
 * doesn't confidently claim a wire was disconnected when it did
 * nothing. Receipt carries the deleted edge's snapshot so the LLM
 * can quote the actual source/target pair.
 */

const argsSchema = z.object({ edgeId: z.string().min(1) }).strict();

export const removeEdgeTool: AssistantTool = {
  name: "remove_edge",
  description:
    "Delete an edge by id. Returns { changed: ['__delete'], entity } on success — quote entity.id + the source/target pair before claiming the wire was removed. A missing id returns ok: false (no-op).",
  parameters: {
    type: "object",
    properties: {
      edgeId: { type: "string" },
    },
    required: ["edgeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const { edgeId } = argsSchema.parse(rawArgs);
    const before = useWorkflowStore.getState();
    const edge = before.edges.find((e) => e.id === edgeId);
    if (!edge) {
      return {
        ok: false,
        error: `No edge with id ${edgeId} — nothing to delete (no-op).`,
        edgeId,
      };
    }
    useWorkflowStore.getState().removeEdge(edgeId);
    return {
      ok: true,
      changed: ["__delete"],
      entity: snapshotEdge(edge),
    };
  },
};
