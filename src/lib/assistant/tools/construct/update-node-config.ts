import { z } from "zod";

import { useCanvasUiStore } from "@/lib/stores/canvas-ui-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";
import { diffShallow } from "./diff-config";
import { validateConfigPatch } from "./validate-config-patch";

/**
 * update_node_config — Slice 7.3 (ADR-0042) + post-write receipts
 * (ADR-0065) + selection-default targeting (ADR-0069 F6).
 *
 * Patch a node's config. Shallow-merge — only the fields you provide
 * change; everything else stays. Use to set Text.text, LLM.model,
 * Higgsfield.aspectRatio, etc. Inspect read_node_state first if you're
 * unsure what fields the node currently has.
 *
 * ## Selection-default `nodeId` (ADR-0069 F6)
 *
 * `nodeId` is OPTIONAL. When omitted:
 *   - If exactly 1 node is selected on the canvas → that node is used,
 *     and the receipt's `selectionDefault: true` flag tells the LLM
 *     it operated on the user's deictic anchor (the same node carried
 *     by the `## FOCUSED NODE` knowledge block).
 *   - If 0 or 2+ nodes are selected → `{ ok: false, error: "ambiguous
 *     target …" }` so the LLM has to either pass an explicit id or
 *     ask the user to disambiguate.
 *
 * This is a safety net for the duplicate-text-node bug class — when the
 * LLM forgets to copy the `## FOCUSED NODE` id literally and tries to
 * patch by content, omitting `nodeId` now resolves to the user's
 * actual selection instead of "the first node that matches the text".
 *
 * Patches go through {@link validateConfigPatch} before persisting so
 * the assistant gets immediate feedback when it writes a bad value
 * (e.g. an unknown `fal-image.model`).
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
    nodeId: z.string().min(1).optional(),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

export const updateNodeConfigTool: AssistantTool = {
  name: "update_node_config",
  description:
    "Shallow-merge a config patch onto a node. Use to set Text.text, LLM.model, Higgsfield.aspectRatio, etc. `nodeId` is OPTIONAL — when omitted and exactly 1 node is selected on the canvas, that node is used (mirroring the user's deictic anchor in `## FOCUSED NODE`); when 0 or 2+ are selected the call fails with `ambiguous target`. Returns { before, after, changed[], nodeId, nodeKind, selectionDefault? } on success — quote `changed` verbatim before claiming the update landed.",
  parameters: {
    type: "object",
    properties: {
      nodeId: {
        type: "string",
        description:
          "Optional. When omitted, defaults to `selectedNodeIds[0]` if exactly 1 node is selected. Otherwise the call fails. PREFER passing the id explicitly — copy it from the `## FOCUSED NODE` block.",
      },
      config: {
        type: "object",
        description: "Config patch. Shallow-merged onto the node's config.",
      },
    },
    required: ["config"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const ws = useWorkflowStore.getState();

    let resolvedNodeId = args.nodeId;
    let selectionDefault = false;
    if (!resolvedNodeId) {
      const sel = ws.selectedNodeIds;
      if (sel.length === 1) {
        resolvedNodeId = sel[0];
        selectionDefault = true;
      } else if (sel.length === 0) {
        return {
          ok: false,
          error:
            "ambiguous target — no `nodeId` was passed and no node is selected on the canvas. Either pass `nodeId` explicitly (copy it from `## FOCUSED NODE`) or have the user select a node first.",
        };
      } else {
        return {
          ok: false,
          error: `ambiguous target — no \`nodeId\` was passed and ${sel.length} nodes are selected. Pass \`nodeId\` explicitly to disambiguate, or call \`ask_user\` to clarify which one the user means.`,
          selectedNodeIds: sel,
        };
      }
    }

    const node = ws.nodes.find((n) => n.id === resolvedNodeId);
    if (!node) {
      return { ok: false, error: `No node with id ${resolvedNodeId}` };
    }
    const validationError = validateConfigPatch(node.kind, args.config);
    if (validationError) {
      return { ok: false, error: validationError };
    }
    const before = { ...(node.config as Record<string, unknown>) };
    ws.updateNodeConfig(resolvedNodeId, args.config);
    const after = {
      ...(useWorkflowStore.getState().nodes.find((n) => n.id === resolvedNodeId)
        ?.config as Record<string, unknown> | undefined),
    };
    const { changed, pickedBefore, pickedAfter } = diffShallow(before, after);
    if (changed.length === 0) {
      return {
        ok: false,
        error:
          "no-op patch — config did not change. The keys you provided either matched the existing values or are not honored by this node kind. Read read_node_state for ground truth before retrying.",
        attemptedPatch: args.config,
        nodeId: resolvedNodeId,
        nodeKind: node.kind,
        selectionDefault: selectionDefault || undefined,
      };
    }
    // ADR-0069 F7: emit a canvas pulse on the patched node so the user
    // sees AT A GLANCE which card actually changed — eliminating the
    // "did anything happen?" confusion when the LLM patches a duplicate
    // and the user is staring at the wrong card.
    useCanvasUiStore.getState().markRecentlyMutated(resolvedNodeId);
    return {
      ok: true,
      nodeId: resolvedNodeId,
      nodeKind: node.kind,
      changed,
      before: pickedBefore,
      after: pickedAfter,
      selectionDefault: selectionDefault || undefined,
    };
  },
};