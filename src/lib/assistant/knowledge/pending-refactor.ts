import { useAssistantStore } from "@/lib/stores/assistant-store";

/**
 * Knowledge dimension: pending refactor proposal.
 *
 * Surfaces the currently-queued `propose_refactor` proposal (if any)
 * to the assistant so it can:
 *   - Recognize that a proposal is awaiting confirmation in the modal
 *     instead of re-proposing the same ops over and over.
 *   - See whether the last apply attempt failed (and the error text)
 *     so it can offer to fix and retry.
 *   - Honor a user's "apply for me" request by calling
 *     `apply_pending_refactor` on the EXISTING queued proposal
 *     rather than emitting an empty turn.
 *
 * Compact by design — the full operations array is the assistant's
 * own previous tool call result and would balloon the prompt if we
 * re-emitted it here. We surface the *summary*, *status*, *count*,
 * and (when failed) the *error message*. That's enough to drive the
 * three behaviors above without duplicating the proposal.
 *
 * Returns null when no proposal is pending — the bundle skips the
 * section entirely so the prompt stays clean for the common case.
 */

export function buildPendingRefactorKnowledge(): string | null {
  const pending = useAssistantStore.getState().pendingRefactor;
  if (!pending) return null;
  // We only surface "live" statuses — `applied` clears itself shortly
  // after success, `cancelled` / `rejected` are user-driven dismissals
  // that should leave the assistant blank-slated for the next turn.
  // `pending`, `applying`, and `failed` are the states where the
  // proposal is still actionable.
  if (
    pending.status !== "pending" &&
    pending.status !== "applying" &&
    pending.status !== "failed"
  ) {
    return null;
  }

  const lines = ["## PENDING REFACTOR PROPOSAL"];
  lines.push(
    `_(One propose_refactor batch is queued in the preview modal — the user has NOT clicked Apply yet.)_`,
  );
  lines.push("");
  lines.push(`- **Summary:** ${pending.summary}`);
  lines.push(`- **Status:** ${pending.status}`);
  lines.push(`- **Operations queued:** ${pending.operations.length}`);
  if (pending.status === "failed" && pending.error) {
    lines.push(`- **Last apply error:** ${pending.error}`);
  }
  lines.push("");
  lines.push(
    "If the user asks you to apply / retry / go ahead in chat, call `apply_pending_refactor` (NOT `propose_refactor` again — that would overwrite the queued proposal). If the user asks for changes, call `propose_refactor` with the new operations to replace the queue. If the last attempt failed, fix the offending op and re-`propose_refactor` before applying.",
  );

  return lines.join("\n");
}
