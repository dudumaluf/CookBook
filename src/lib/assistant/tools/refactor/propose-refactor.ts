import { dedupCascadeRedundantOps } from "@/lib/assistant/refactor-dedup";
import { refactorProposalSchema } from "@/lib/assistant/refactor-types";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import type { AssistantTool } from "../index";
import { validateConfigPatch } from "../construct/validate-config-patch";

/**
 * propose_refactor — Phase 3.
 *
 * The ONLY mutation path the assistant should take during an analyze
 * conversation. Bundles a SUMMARY + an ordered list of mutation ops
 * into a single `PendingRefactor` on the assistant store, then
 * returns control to the reasoner with a "queued, awaiting confirmation"
 * receipt.
 *
 * What happens next:
 *   1. The reasoner stops calling tools and writes its final assistant
 *      message.
 *   2. The `RefactorPreviewModal` (subscribing to `pendingRefactor`)
 *      opens automatically.
 *   3. The user reviews the diff and either applies all-or-nothing or
 *      cancels / asks for changes.
 *
 * The tool intentionally doesn't apply ops itself — that's
 * `refactor-apply.ts` after the user confirms in the modal. Keeping
 * the apply gate user-driven preserves the analysis flow's "no
 * surprise mutations" contract.
 */

export const proposeRefactorTool: AssistantTool = {
  name: "propose_refactor",
  description:
    "Queue a bundle of graph mutations (add_node, remove_node, update_node_config, move_node, add_edge, remove_edge) for the user to review in a preview modal. Use this — NOT the raw construct tools — when the user confirms an analysis suggestion. The user must click Apply in the modal before any mutation runs. Pass `summary` (one-line user-facing description) and `operations[]` (ordered list of ops to apply atomically). New `add_node` ops can carry `clientId`s that subsequent `add_edge` ops can reference as source/target.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "One-line description of the refactor (shown at the top of the preview modal). E.g. 'Collapse 3 text chunks into one Concat node'.",
      },
      operations: {
        type: "array",
        minItems: 1,
        description:
          "Ordered list of mutation ops. New nodes (add_node) may carry a `clientId`; subsequent add_edge ops can reference that clientId as source/target.",
        items: {
          type: "object",
          properties: {
            op: {
              type: "string",
              enum: [
                "add_node",
                "remove_node",
                "update_node_config",
                "move_node",
                "add_edge",
                "remove_edge",
              ],
            },
            clientId: { type: "string" },
            kind: { type: "string" },
            position: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["x", "y"],
              additionalProperties: false,
            },
            config: { type: "object" },
            nodeId: { type: "string" },
            edgeId: { type: "string" },
            source: { type: "string" },
            sourceHandle: { type: "string" },
            target: { type: "string" },
            targetHandle: { type: "string" },
          },
          required: ["op"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "operations"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const parsed = refactorProposalSchema.safeParse(rawArgs);
    if (!parsed.success) {
      // The Zod error message is the most actionable thing we can hand
      // back — it tells the LLM exactly which op variant fails and why.
      return {
        ok: false,
        error: `Invalid proposal shape: ${parsed.error.message}`,
      };
    }

    // Strip cascade-redundant `remove_edge` ops so the modal preview
    // matches what actually runs. Without this filter, a perfectly
    // valid proposal that included both `remove_node X` and
    // `remove_edge Y-out-…` (Y incident to X) would show up as N ops
    // queued but execute as N-1 — confusing for the user. The applier
    // also tolerates these cases at runtime; this is the cosmetic
    // counterpart on the way in.
    const ws = useWorkflowStore.getState();
    const dedup = dedupCascadeRedundantOps(parsed.data.operations, ws.edges);

    // Per-kind validation of every config patch in the bundle (both
    // `add_node` initial configs and `update_node_config` patches). For
    // `add_node` we know the kind directly; for `update_node_config` we
    // look up the target node in the current workflow state OR — when
    // the op references a `clientId` declared earlier in the same
    // bundle — we use that op's `kind`. Rejecting at queue-time gives
    // the LLM immediate feedback instead of letting a bad patch slip
    // into the modal where the user would just see the apply fail.
    const clientIdToKind = new Map<string, string>();
    for (const op of dedup.operations) {
      if (op.op === "add_node" && op.clientId) {
        clientIdToKind.set(op.clientId, op.kind);
      }
    }
    for (const op of dedup.operations) {
      if (op.op === "add_node" && op.config) {
        const err = validateConfigPatch(op.kind, op.config);
        if (err) return { ok: false, error: err };
      }
      if (op.op === "update_node_config") {
        const existing = ws.nodes.find((n) => n.id === op.nodeId);
        const kind = existing?.kind ?? clientIdToKind.get(op.nodeId);
        if (!kind) {
          return {
            ok: false,
            error: `update_node_config rejected: nodeId '${op.nodeId}' doesn't match any existing node or earlier add_node clientId in this proposal.`,
          };
        }
        const err = validateConfigPatch(kind, op.config);
        if (err) return { ok: false, error: err };
      }
    }

    const id = `refactor_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    useAssistantStore.getState().setPendingRefactor({
      id,
      summary: parsed.data.summary,
      operations: dedup.operations,
      status: "pending",
      proposedAt: Date.now(),
    });

    return {
      ok: true,
      id,
      message:
        dedup.removed.length > 0
          ? `Proposal queued (${dedup.removed.length} cascade-redundant remove_edge op(s) filtered). Awaiting user confirmation in the refactor preview modal — write your final assistant message and stop calling tools.`
          : "Proposal queued. Awaiting user confirmation in the refactor preview modal — write your final assistant message and stop calling tools.",
    };
  },
};
