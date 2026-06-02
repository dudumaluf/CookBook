import { applyPendingRefactor } from "@/lib/assistant/refactor-apply";
import { useAssistantStore } from "@/lib/stores/assistant-store";

import type { AssistantTool } from "../index";

/**
 * apply_pending_refactor — explicit "user said apply" tool.
 *
 * Background:
 *   `propose_refactor` queues a `PendingRefactor` and the user clicks
 *   the modal's "Apply all" button to run it. That's the canonical
 *   path. But sometimes the user types "apply for me" / "go ahead" /
 *   "retry it" in chat — and without this tool, the assistant has no
 *   way to honor that request. It would either reply "applying!" with
 *   no actions (the bug we're fixing here) or re-emit the same
 *   `propose_refactor` (overwriting the pending one and forcing the
 *   user back to the modal).
 *
 *   This tool is the chat-side equivalent of clicking the modal
 *   button: it calls `applyPendingRefactor()` directly and returns the
 *   same result the modal would observe. The assistant can use it any
 *   time the user has explicitly approved the pending proposal in
 *   prose.
 *
 * Safety contract:
 *   The tool *requires* an existing pending proposal and treats the
 *   user's chat message as the consent gate (same as the modal
 *   button). It does not propose, edit, or auto-generate anything —
 *   it strictly applies what's already queued.
 *
 *   Failure modes (returned to the LLM as `{ ok: false, error }`):
 *     - No pending refactor (assistant should re-propose).
 *     - Apply rolled back (assistant should re-read the canvas, fix
 *       the proposal, and try again).
 */
export const applyPendingRefactorTool: AssistantTool = {
  name: "apply_pending_refactor",
  description:
    "Apply the currently-queued refactor proposal that's awaiting user confirmation in the preview modal. Use this ONLY when the user has explicitly told you to apply / retry / go ahead in chat (e.g. 'apply for me', 'do it', 'aplica pra mim'). Equivalent to clicking the modal's Apply button. Returns the same atomic-or-rollback result. If there's no pending proposal, this fails — re-call `propose_refactor` with fresh ops.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async () => {
    const pending = useAssistantStore.getState().pendingRefactor;
    if (!pending) {
      return {
        ok: false,
        error:
          "No pending refactor to apply. Call `propose_refactor` to queue one first.",
      };
    }
    if (pending.status === "applying") {
      return {
        ok: false,
        error:
          "A refactor is already being applied. Wait for it to finish before retrying.",
      };
    }
    const result = await applyPendingRefactor();
    if (result.ok) {
      return {
        ok: true,
        applied: result.appliedCount,
        message: `Applied ${result.appliedCount} op(s). The proposal has been cleared.`,
      };
    }
    return {
      ok: false,
      error: result.error ?? "Apply failed for an unknown reason.",
      appliedCount: result.appliedCount,
    };
  },
};
