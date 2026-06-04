import { z } from "zod";

import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";
import { diffShallow } from "./diff-config";
import { validateConfigPatch } from "./validate-config-patch";

/**
 * update_node_config — Slice 7.3 (ADR-0042) + post-write receipts (2026-06-03).
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
 *
 * Post-write receipt (anti-confabulation):
 *   - On success the tool returns `{ before, after, changed }` so the
 *     LLM can quote the actual mutation verbatim instead of saying
 *     "atualizei pra 10" when nothing happened.
 *   - When the patch produced no diff (e.g. user already has that
 *     value, or the patch named a key the node doesn't honor), the
 *     tool returns `{ ok: false, error: "no-op patch …", attemptedPatch }`
 *     so the LLM stops, reads the real state, and explains the mismatch.
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
    "Shallow-merge a config patch onto a node. Use to set Text.text, LLM.model, Higgsfield.aspectRatio, etc. Returns { before, after, changed[] } on success — quote `changed` verbatim before claiming the update landed.",
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
    const before = { ...(node.config as Record<string, unknown>) };
    ws.updateNodeConfig(args.nodeId, args.config);
    const after = {
      ...(useWorkflowStore.getState().nodes.find((n) => n.id === args.nodeId)
        ?.config as Record<string, unknown> | undefined),
    };
    const { changed, pickedBefore, pickedAfter } = diffShallow(before, after);
    if (changed.length === 0) {
      return {
        ok: false,
        error:
          "no-op patch — config did not change. The keys you provided either matched the existing values or are not honored by this node kind. Read read_node_state for ground truth before retrying.",
        attemptedPatch: args.config,
        nodeId: args.nodeId,
        nodeKind: node.kind,
      };
    }
    return {
      ok: true,
      nodeId: args.nodeId,
      nodeKind: node.kind,
      changed,
      before: pickedBefore,
      after: pickedAfter,
    };
  },
};
