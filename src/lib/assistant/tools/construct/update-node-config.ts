import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";

/**
 * update_node_config — Slice 7.3 (ADR-0042).
 *
 * Patch a node's config. Shallow-merge — only the fields you provide
 * change; everything else stays. Use to set Text.text, LLM.model,
 * Higgsfield.aspectRatio, etc. Inspect read_node_state first if
 * you're unsure what fields the node currently has.
 */

const argsSchema = z
  .object({
    nodeId: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

export const updateNodeConfigTool: AssistantTool = {
  name: "update_node_config",
  description:
    "Shallow-merge a config patch onto a node. Use to set Text.text, LLM.model, Higgsfield.aspectRatio, etc.",
  parameters: {
    type: "object",
    properties: {
      nodeId: { type: "string" },
      config: {
        type: "object",
        description: "Config patch. Shallow-merged onto the node's config.",
      },
    },
    required: ["nodeId", "config"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();
    if (!ws.nodes.find((n) => n.id === args.nodeId)) {
      return { ok: false, error: `No node with id ${args.nodeId}` };
    }
    ws.updateNodeConfig(args.nodeId, args.config);
    return { ok: true };
  },
};
