"use client";

import { Loader2, MessageSquare, Play, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { executePlan } from "@/lib/assistant/run";
import type { AssistantMessage } from "@/lib/assistant/types";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { useLayoutStore } from "@/lib/stores/layout-store";

/**
 * ChatSheet (Slice 6.4b — wired).
 *
 * Slide-up overlay anchored above the prompt bar. Renders the assistant
 * chat history from the in-memory `useAssistantStore`. Each assistant
 * message that produced a valid plan shows a "Run plan" button so the
 * user can confirm + execute. Errors render inline.
 */
export function ChatSheet() {
  const { chatSheetOpen, setChatSheetOpen } = useLayoutStore();
  const { messages, isThinking, clear } = useAssistantStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isThinking]);

  if (!chatSheetOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Conversation history"
      data-testid="chat-sheet"
      className="pointer-events-auto flex w-full max-w-[640px] flex-col rounded-2xl border border-border/80 bg-popover/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
      style={{ height: "min(60vh, 480px)" }}
    >
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">Conversation</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-muted-foreground"
            onClick={() => clear()}
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

      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="flex flex-col gap-3 px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-start gap-2 px-1 py-2">
              <p className="text-sm text-foreground/80">
                Hi — what would you like to make?
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Try: <span className="text-foreground/80">&quot;give me 4 photos of me as a 90s movie character&quot;</span>.
                I&apos;ll pick the right recipe + Soul ID, show you a plan, and you confirm before I run.
              </p>
            </div>
          ) : (
            messages.map((m, i) => <Message key={i} message={m} />)
          )}
          {isThinking ? (
            <div
              data-testid="assistant-thinking"
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              Thinking…
            </div>
          ) : null}
        </div>
      </ScrollArea>
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
