import { z } from "zod";

import { useExecutionStore } from "@/lib/stores/execution-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * read_node_state — Slice 7.2 (ADR-0041).
 *
 * Detailed read for ONE node — its config, last execution record
 * (status, output, history), and surrounding edges. Use when the
 * canvas summary doesn't carry enough detail (e.g. wanting to see
 * the actual text of a node's last LLM response, or its full
 * history of past generations).
 */

const argsSchema = z
  .object({
    nodeId: z.string().min(1),
  })
  .strict();

export const readNodeStateTool: AssistantTool = {
  name: "read_node_state",
  description:
    "Read the full state of one node by id — config, last execution record (status, output, error, usage, history), and edges connected to it. Use when you need details beyond the canvas summary.",
  parameters: {
    type: "object",
    properties: {
      nodeId: {
        type: "string",
        description: "The node's id as it appears on the canvas.",
      },
    },
    required: ["nodeId"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const { nodeId } = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    const node = ws.nodes.find((n) => n.id === nodeId);
    if (!node) {
      return { found: false, error: `No node with id ${nodeId}` };
    }
    const record = useExecutionStore.getState().records.get(nodeId);
    const incomingEdges = ws.edges.filter((e) => e.target === nodeId);
    const outgoingEdges = ws.edges.filter((e) => e.source === nodeId);
    return {
      found: true,
      node: {
        id: node.id,
        kind: node.kind,
        position: node.position,
        config: node.config,
      },
      record: record ?? null,
      edges: {
        incoming: incomingEdges,
        outgoing: outgoingEdges,
      },
    };
  },
};
