"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Play,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { ModelSelector } from "@/components/assistant/model-selector";
import {
  isPromptEditProposal,
  PromptEditProposalCard,
} from "@/components/assistant/prompt-edit-proposal-card";
import { PromptOverrideBadge } from "@/components/assistant/prompt-override-badge";
import { RolePicker } from "@/components/assistant/role-picker";
import { Button } from "@/components/ui/button";
import type { ReasonerEvent } from "@/lib/assistant/reasoner";
import { executePlan } from "@/lib/assistant/run";
import { clearChatForProject } from "@/lib/sync/chat-sync";
import type { AssistantMessage } from "@/lib/assistant/types";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * ChatSheet — Slice 7.3 (ADR-0042).
 *
 * Slide-up overlay anchored above the prompt bar. Renders:
 *   1. Persisted assistant chat (`messages`).
 *   2. The current run's live trace (`liveEvents`) — tool calls and
 *      narrations as they fire from the reasoner. After the run,
 *      the trace remains so the user can scroll it back; the next
 *      submit resets it via `resetLive()`.
 *   3. The pending ask_user question, if any (paused state).
 */
export function ChatSheet() {
  const { chatSheetOpen, setChatSheetOpen } = useLayoutStore();
  const { messages, isThinking, liveEvents, pendingQuestion } =
    useAssistantStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message / thinking flip. We seed
  // `behavior: "smooth"` so the user *sees* new content sliding in
  // (premium polish vs a hard jump). Native scrollIntoView on a
  // sentinel at the end is more robust than setting scrollTop on a
  // ref that might not be the actual scroll container.
  useEffect(() => {
    if (!chatSheetOpen) return;
    bottomRef.current?.scrollIntoView({
      block: "end",
      behavior: "smooth",
    });
  }, [chatSheetOpen, messages.length, liveEvents.length, isThinking]);

  if (!chatSheetOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Conversation history"
      data-testid="chat-sheet"
      className="pointer-events-auto flex w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-border/80 bg-popover/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
      style={{ height: "min(60vh, 480px)" }}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">Conversation</span>
        </div>
        <div className="flex items-center gap-1">
          <PromptOverrideBadge />
          <RolePicker />
          <ModelSelector />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-muted-foreground"
            onClick={() => void clearChatForProject()}
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={() => setChatSheetOpen(false)}
            aria-label="Close conversation"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Native scrollable body. `flex-1 min-h-0` is the canonical
       *  "make me actually fill the bounded parent and scroll inside"
       *  combo for a flex-col layout (same trick BaseNode uses for
       *  long LLM outputs). `nowheel` keeps wheel events inside the
       *  chat from leaking into React Flow's pan/zoom on the canvas
       *  behind us. */}
      <div
        ref={scrollRef}
        data-testid="chat-sheet-scroll"
        className="nowheel flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
        onWheelCapture={(e) => e.stopPropagation()}
      >
        {messages.length === 0 && liveEvents.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-1 py-2">
            <p className="text-sm text-foreground/80">
              Hi — what would you like to make?
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Try:{" "}
              <span className="text-foreground/80">
                &quot;give me 4 photos of me as a 90s movie character&quot;
              </span>
              . I&apos;ll pick the right recipe + Soul ID, run the engine,
              and surface results in your gallery.
            </p>
          </div>
        ) : (
          messages.map((m, i) => <Message key={i} message={m} />)
        )}
        {liveEvents.length > 0 ? (
          <LiveTrace events={liveEvents} />
        ) : null}
        {pendingQuestion ? (
          <PendingQuestionCard
            question={pendingQuestion.question}
            options={pendingQuestion.options}
          />
        ) : null}
        {isThinking ? (
          <div
            data-testid="assistant-thinking"
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            Thinking…
          </div>
        ) : null}
        <div ref={bottomRef} aria-hidden />
      </div>
    </div>
  );
}

function LiveTrace({ events }: { events: ReasonerEvent[] }) {
  // Pair tool_call events with their tool_result events for compact
  // rendering. Narration / ask_user / errors render in line.
  const resultsById = new Map<string, ReasonerEvent>();
  for (const e of events) {
    if (e.type === "tool_result") resultsById.set(e.callId, e);
  }
  return (
    <div
      data-testid="assistant-live-trace"
      className="flex flex-col gap-2 rounded-xl border border-border/40 bg-foreground/[0.02] px-3 py-2"
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Trace
      </p>
      {events.map((e, i) => {
        if (e.type === "tool_call") {
          const result = resultsById.get(e.callId);
          // Phase C — `propose_prompt_edit` returns a structured
          // proposal we render as a dedicated card instead of the
          // generic ToolCallRow. The user clicks Apply / Reject on
          // the card; the assistant only suggested.
          if (
            result?.type === "tool_result" &&
            isPromptEditProposal(result.result)
          ) {
            return (
              <div
                key={`call-${e.callId}`}
                className="flex flex-col gap-1.5"
              >
                <ToolCallRow call={e} result={result} />
                <PromptEditProposalCard proposal={result.result} />
              </div>
            );
          }
          return (
            <ToolCallRow
              key={`call-${e.callId}`}
              call={e}
              result={result}
            />
          );
        }
        if (e.type === "tool_result") return null;
        if (e.type === "narration") {
          return (
            <p
              key={`narration-${i}`}
              className="text-xs italic text-foreground/80"
            >
              {e.content}
            </p>
          );
        }
        if (e.type === "ask_user") {
          return null;
        }
        if (e.type === "error") {
          return (
            <p
              key={`err-${i}`}
              className="flex items-center gap-1.5 text-xs text-destructive/90"
            >
              <AlertTriangle className="h-3 w-3" />
              {e.content}
            </p>
          );
        }
        if (e.type === "cap_hit") {
          return (
            <p
              key={`cap-${i}`}
              className="flex items-center gap-1.5 text-xs text-amber-500"
            >
              <AlertTriangle className="h-3 w-3" />
              {e.message}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

function ToolCallRow({
  call,
  result,
}: {
  call: Extract<ReasonerEvent, { type: "tool_call" }>;
  result: ReasonerEvent | undefined;
}) {
  const ok =
    result?.type === "tool_result" &&
    typeof result.result === "object" &&
    result.result !== null &&
    (result.result as { ok?: boolean }).ok !== false;
  return (
    <div className="flex items-start gap-2 text-xs">
      {result === undefined ? (
        <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
      ) : ok ? (
        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
      ) : (
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
      )}
      <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
      <code className="rounded bg-foreground/5 px-1.5 py-0.5 text-[11px] text-foreground/80">
        {call.toolName}
      </code>
      {result?.type === "tool_result" ? (
        <span className="text-[10px] text-muted-foreground/70">
          {result.durationMs}ms
        </span>
      ) : null}
    </div>
  );
}

function PendingQuestionCard({
  question,
  options,
}: {
  question: string;
  options?: string[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-popover/80 px-3 py-2 text-sm shadow-sm">
      <p className="font-medium text-foreground/90">{question}</p>
      {options && options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => (
            <span
              key={opt}
              className="rounded-md border border-border/60 bg-foreground/5 px-2 py-0.5 text-[11px] text-foreground/70"
            >
              {opt}
            </span>
          ))}
        </div>
      ) : null}
      <p className="text-[10.5px] text-muted-foreground">
        Reply in the prompt bar to continue.
      </p>
    </div>
  );
}

function Message({ message }: { message: AssistantMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-accent/15 px-3 py-2 text-sm text-foreground">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-foreground/5 px-3 py-2 text-sm text-foreground/90">
        {message.error ? (
          <p className="text-destructive/90" data-testid="assistant-error">
            {message.error}
          </p>
        ) : message.plan ? (
          <PlanCard plan={message.plan} />
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}
      </div>
      {message.costUsd !== undefined ? (
        <span className="text-[10px] text-muted-foreground/60">
          {message.costUsd.toFixed(4)} USD
        </span>
      ) : null}
    </div>
  );
}

function PlanCard({ plan }: { plan: AssistantMessage["plan"] & {} }) {
  const stepLabels: Record<string, string> = {
    "clear-canvas": "Clear canvas",
    "instantiate-recipe": "Drop recipe",
    "set-node-config": "Configure node",
    "link-soul-id": "Pick Soul ID",
    run: "Run engine",
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-foreground/80">{plan.reasoning}</p>
      {plan.steps.length > 0 ? (
        <ol className="ml-4 list-decimal space-y-0.5 text-[11px] text-muted-foreground">
          {plan.steps.map((s, i) => (
            <li key={i}>{stepLabels[s.kind] ?? s.kind}</li>
          ))}
        </ol>
      ) : null}
      {plan.steps.length > 0 ? (
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-border/40 pt-2">
          <span className="text-[10.5px] text-muted-foreground">
            {plan.confirmation ?? "Run this plan?"}{" "}
            <span className="text-foreground/70">
              ${plan.estimatedCostUsd.toFixed(4)} estimated
            </span>
          </span>
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1 text-[11px]"
            onClick={async () => {
              const result = await executePlan(plan);
              if (!result.ok) {
                toast.error(`Plan failed: ${result.error}`);
                return;
              }
              if (result.runId !== undefined) {
                toast.success("Run started");
              }
            }}
          >
            <Play className="h-3 w-3" />
            Run plan
          </Button>
        </div>
      ) : null}
    </div>
  );
}
