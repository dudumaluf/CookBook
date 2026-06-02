"use client";

import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/use-session";
import { getPromptOverridesRepository } from "@/lib/repositories/supabase-prompt-overrides-repository";
import { useAssistantPromptOverridesStore } from "@/lib/stores/assistant-prompt-overrides-store";
import { cn } from "@/lib/utils";

/**
 * Cookbook Library Phase C — `<PromptEditProposalCard />`.
 *
 * Renders the result of `propose_prompt_edit` in the chat-sheet
 * trace. The card shows:
 *   - The assistant's rationale (why is it asking).
 *   - A diff summary (chars / lines delta + a head/tail preview).
 *   - Apply / Reject buttons (the user is the only principal who
 *     can commit the change to `app_prompt_overrides`).
 *
 * Apply → upsert the override + sync the local store + emit a toast.
 * Reject → swap the card for a "Rejected" confirmation. Either way,
 * the card preserves a "decided" state for the rest of the session
 * so the user doesn't see Apply / Reject lingering on a proposal
 * they already acted on.
 */
export interface PromptEditProposalPayload {
  promptKey: string;
  currentBody: string;
  proposedBody: string;
  currentIsOverride: boolean;
  rationale: string;
  summary: {
    charDelta: number;
    lineDelta: number;
    preview: string;
  };
}

export function PromptEditProposalCard({
  proposal,
}: {
  proposal: PromptEditProposalPayload;
}) {
  const [decision, setDecision] = useState<
    "pending" | "applying" | "applied" | "rejected"
  >("pending");
  const setOverrideLocal = useAssistantPromptOverridesStore(
    (s) => s.setOverrideLocal,
  );
  const { user } = useSession();
  const ownerId = user?.id ?? null;

  async function handleApply() {
    if (!ownerId) {
      toast.error("Sign in to apply prompt edits.");
      return;
    }
    setDecision("applying");
    try {
      await getPromptOverridesRepository().upsert(
        ownerId,
        proposal.promptKey,
        proposal.proposedBody,
      );
      setOverrideLocal(proposal.promptKey, proposal.proposedBody);
      setDecision("applied");
      toast.success("Custom prompt applied.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Apply failed";
      toast.error(`Couldn't apply: ${msg}`);
      setDecision("pending");
    }
  }

  function handleReject() {
    setDecision("rejected");
  }

  return (
    <div
      data-testid="prompt-edit-proposal-card"
      className="flex flex-col gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.04] px-3 py-2.5 text-xs"
    >
      <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
        <Sparkles className="h-3.5 w-3.5" />
        <span className="font-medium">
          Assistant proposes a prompt edit
        </span>
        <span className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider">
          {proposal.promptKey}
        </span>
      </div>
      <p className="text-foreground/85">{proposal.rationale}</p>
      <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
        <span
          className={cn(
            "tabular-nums",
            proposal.summary.charDelta >= 0
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400",
          )}
        >
          {proposal.summary.charDelta >= 0 ? "+" : ""}
          {proposal.summary.charDelta} chars
        </span>
        <span className="tabular-nums">
          {proposal.summary.lineDelta >= 0 ? "+" : ""}
          {proposal.summary.lineDelta} lines
        </span>
        <span className="text-muted-foreground/60">
          {proposal.currentIsOverride
            ? "replaces your current custom prompt"
            : "creates a new custom prompt"}
        </span>
      </div>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-background/40 p-2 font-mono text-[10.5px] leading-relaxed text-foreground/80">
        {proposal.summary.preview}
      </pre>

      {decision === "pending" || decision === "applying" ? (
        <div className="flex items-center justify-end gap-2 border-t border-emerald-500/20 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReject}
            disabled={decision === "applying"}
            data-testid="prompt-edit-proposal-reject"
            className="h-7 gap-1 text-[11px] text-muted-foreground"
          >
            <X className="h-3 w-3" />
            Reject
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={decision === "applying" || !ownerId}
            data-testid="prompt-edit-proposal-apply"
            className="h-7 gap-1 bg-emerald-600 text-[11px] text-white hover:bg-emerald-700"
          >
            {decision === "applying" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Apply
          </Button>
        </div>
      ) : decision === "applied" ? (
        <p className="border-t border-emerald-500/20 pt-2 text-[10.5px] text-emerald-700 dark:text-emerald-400">
          Applied. The next turn uses your new prompt — open the Library to
          review or reset.
        </p>
      ) : (
        <p className="border-t border-emerald-500/20 pt-2 text-[10.5px] text-muted-foreground">
          Rejected. Your prompt is unchanged.
        </p>
      )}
    </div>
  );
}

/**
 * Type guard — narrow a tool_result `result` to our proposal payload.
 * Centralized so the chat-sheet doesn't sprinkle structural casts
 * around its renderer.
 */
export function isPromptEditProposal(
  result: unknown,
): result is PromptEditProposalPayload & { __proposal: "prompt_edit" } {
  if (typeof result !== "object" || result === null) return false;
  const r = result as Record<string, unknown>;
  return (
    r.__proposal === "prompt_edit" &&
    typeof r.promptKey === "string" &&
    typeof r.proposedBody === "string" &&
    typeof r.currentBody === "string" &&
    typeof r.rationale === "string" &&
    typeof r.summary === "object" &&
    r.summary !== null
  );
}
