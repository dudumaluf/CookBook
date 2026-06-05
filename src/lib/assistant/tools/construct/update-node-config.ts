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
    // Re-read from the LIVE store (post-write) — this is also our
    // verify-after-write checkpoint. If `after` doesn't reflect the
    // patch fields, the store mutation silently dropped on the floor
    // and we have to surface that as an error instead of pretending
    // success.
    const liveNode = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === resolvedNodeId);
    if (!liveNode) {
      // Node was deleted between our read and write — exceedingly
      // rare, but theoretically possible if a parallel tool removes
      // it. Be loud rather than silently dropping.
      return {
        ok: false,
        error: `verify-after-write failed: node ${resolvedNodeId} disappeared between read and write.`,
        nodeId: resolvedNodeId,
      };
    }
    const after = {
      ...(liveNode.config as Record<string, unknown> | undefined),
    };
    // ADR-0070 verify-after-write: every key the LLM tried to set
    // MUST be present and equal in the post-write read-back. Without
    // this check, a corrupted store path (e.g. middleware swallowing
    // updates, bad migration overlay) could let the tool report
    // success against a canvas that never received the change — the
    // exact failure mode the user kept hitting in production.
    const verifyMismatches: { key: string; expected: unknown; got: unknown }[] =
      [];
    for (const [k, expected] of Object.entries(args.config)) {
      const got = (after as Record<string, unknown>)[k];
      if (!shallowEqual(got, expected)) {
        verifyMismatches.push({ key: k, expected, got });
      }
    }
    if (verifyMismatches.length > 0) {
      return {
        ok: false,
        error: `verify-after-write failed on node ${resolvedNodeId}: re-reading the canvas after the patch did NOT show the expected value(s). The store path is corrupted — DO NOT claim the change landed. Mismatches: ${JSON.stringify(
          verifyMismatches.slice(0, 4),
        )}`,
        nodeId: resolvedNodeId,
        nodeKind: node.kind,
        verifyMismatches,
      };
    }
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

/**
 * Cheap structural equality used by the verify-after-write check.
 * Strings/numbers/booleans/null compare with `Object.is`; arrays
 * compare element-wise; plain objects compare key-wise (one level
 * deep). Anything more exotic falls back to `JSON.stringify`. The
 * intent is to catch the common "patch didn't land" failure modes
 * (string flipped, number not updated, simple object replaced) WITHOUT
 * triggering false positives on identity-vs-equality nits like a new
 * array reference holding the same items.
 */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!Object.is(ao[k], bo[k])) {
        // One level of structural fallback so a fresh array reference
        // holding the same primitive items still counts as equal.
        try {
          if (JSON.stringify(ao[k]) !== JSON.stringify(bo[k])) return false;
        } catch {
          return false;
        }
      }
    }
    return true;
  }
  return false;
}