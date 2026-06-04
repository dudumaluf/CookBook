import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";
import { snapshotNode } from "./diff-config";

/**
 * remove_node — Slice 7.3 + post-write receipts (2026-06-03).
 *
 * Idempotent — a missing id is a no-op (`ok: false` so the LLM
 * doesn't claim a delete that did nothing). Cascades through any
 * connected edges, and the receipt counts how many were swept.
 */

const argsSchema = z.object({ nodeId: z.string().min(1) }).strict();

export const removeNodeTool: AssistantTool = {
  name: "remove_node",
  description:
    "Delete a node by id. Cascade-removes any edges connected to it. Returns { changed: ['__delete'], entity, cascadedEdges } on success — quote entity.id + entity.kind before claiming the delete landed. Idempotent — a missing id returns ok: false (no-op).",
  parameters: {
    type: "object",
    properties: {
      nodeId: { type: "string" },
    },
    required: ["nodeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const { nodeId } = argsSchema.parse(rawArgs);
    const before = useWorkflowStore.getState();
    const node = before.nodes.find((n) => n.id === nodeId);
    if (!node) {
      return {
        ok: false,
        error: `No node with id ${nodeId} — nothing to delete (no-op).`,
        nodeId,
      };
    }
    const cascadedEdgeIds = before.edges
      .filter((e) => e.source === nodeId || e.target === nodeId)
      .map((e) => e.id);
    useWorkflowStore.getState().removeNode(nodeId);
    return {
      ok: true,
      changed: ["__delete"],
      entity: snapshotNode(node),
      cascadedEdgeCount: cascadedEdgeIds.length,
      cascadedEdgeIds,
    };
  },
};
