import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";
import { validateConfigPatch } from "./validate-config-patch";

/**
 * update_node_config — Slice 7.3 (ADR-0042).
 *
 * Patch a node's config. Shallow-merge — only the fields you provide
 * change; everything else stays. Use to set Text.text, LLM.model,
 * Higgsfield.aspectRatio, etc. Inspect read_node_state first if
 * you're unsure what fields the node currently has.
 *
 * Patches go through {@link validateConfigPatch} before persisting so
 * the assistant gets immediate feedback when it writes a bad value
 * (e.g. an unknown `fal-image.model`). The migrate-graph path will
 * still self-heal legacy values on load — this is just the front-door
 * filter that prevents future corruption.
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
    const node = ws.nodes.find((n) => n.id === args.nodeId);
    if (!node) {
      return { ok: false, error: `No node with id ${args.nodeId}` };
    }
    const validationError = validateConfigPatch(node.kind, args.config);
    if (validationError) {
      return { ok: false, error: validationError };
    }
    ws.updateNodeConfig(args.nodeId, args.config);
    return { ok: true };
  },
};
