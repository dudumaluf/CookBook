"use client";

import { ArrowUp, Loader2, Sparkles, ChevronUp, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatSheet } from "./chat-sheet";
import { useSession } from "@/lib/auth/use-session";
import { runReasoner } from "@/lib/assistant/reasoner";
import { persistMessage } from "@/lib/sync/chat-sync";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";

/**
 * PromptBar
 *
 * Always-visible primary input. When the user toggles the chat history (chevron
 * or Cmd+J), the ChatSheet appears above it, making the prompt bar feel like
 * the sheet's footer.
 *
 * Day 1: form submit is a no-op (wired in M0a). "/" focuses the textarea.
 */
export function PromptBar() {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { chatSheetOpen, toggleChatSheet, setChatSheetOpen, libraryOpen, queueOpen } =
    useLayoutStore();
  const { user } = useSession();
  const {
    isThinking,
    appendMessage,
    setThinking,
    setAbortController,
    appendLiveEvent,
    resetLive,
    setPendingQuestion,
  } = useAssistantStore();
  const projectId = useProjectStore((s) => s.id);

  async function handleSubmit() {
    const text = value.trim();
    if (!text || isThinking || !user) return;
    if (!projectId) {
      toast.error("No active project. Wait for cloud sync to load.");
      return;
    }
    setValue("");
    const userMsg = {
      role: "user" as const,
      content: text,
      timestamp: Date.now(),
    };
    appendMessage(userMsg);
    void persistMessage(userMsg);
    setChatSheetOpen(true);
    setThinking(true);
    resetLive();
    const controller = new AbortController();
    setAbortController(controller);
    try {
      // Slice 7.3 — runReasoner replaces the one-shot planFromAssistant.
      // Tool calls dispatch live; we render the trace via onEvent and
      // persist only the final assistant message.
      const result = await runReasoner({
        userMessage: text,
        ownerId: user.id,
        projectId,
        signal: controller.signal,
        onEvent: (e) => {
          appendLiveEvent(e);
          if (e.type === "ask_user") {
            setPendingQuestion({
              question: e.question,
              ...(e.options ? { options: e.options } : {}),
            });
          }
        },
      });
      // Persist the final assistant message — short summary + cost.
      const finalContent = result.finalText
        ? result.finalText
        : result.aborted
          ? "(aborted)"
          : result.cappedAt
            ? `(stopped — ${result.cappedAt} cap reached)`
            : "(no response)";
      const assistantMsg = {
        role: "assistant" as const,
        content: finalContent,
        ...(result.totalCostUsd > 0
          ? { costUsd: result.totalCostUsd }
          : {}),
        timestamp: Date.now(),
      };
      appendMessage(assistantMsg);
      void persistMessage(assistantMsg);
      if (result.cappedAt === "cost") {
        toast.warning("Cost cap reached. Run paused.");
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      const errorMsg = {
        role: "assistant" as const,
        content: "",
        error: msg,
        timestamp: Date.now(),
      };
      appendMessage(errorMsg);
      void persistMessage(errorMsg);
      toast.error(`Assistant failed: ${msg}`);
    } finally {
      setThinking(false);
      setAbortController(null);
    }
  }

  // Reserve breathing space for floating panels so the prompt bar centers
  // between them rather than under them.
  const padLeft = libraryOpen ? "calc(280px + 1.5rem)" : "1.5rem";
  const padRight = queueOpen ? "calc(320px + 1.5rem)" : "1.5rem";

  // Global "/" focuses the prompt bar unless the user is already typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      role="search"
      aria-label="Assistant prompt"
      className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex flex-col items-center gap-2 transition-[padding] duration-200"
      style={{ paddingLeft: padLeft, paddingRight: padRight }}
    >
      {chatSheetOpen && <ChatSheet />}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="pointer-events-auto mx-auto flex w-full max-w-[640px] flex-col rounded-2xl border border-border/80 bg-popover/95 shadow-lg shadow-black/30 backdrop-blur-xl"
      >
        {/* Chevron handle to toggle chat history */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleChatSheet}
              aria-label={chatSheetOpen ? "Hide conversation" : "Show conversation"}
              aria-pressed={chatSheetOpen}
              className="mx-auto -mt-0 flex h-3 w-12 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:text-muted-foreground"
            >
              {chatSheetOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronUp className="h-3 w-3" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {chatSheetOpen ? "Hide conversation (⌘J)" : "Show conversation (⌘J)"}
          </TooltipContent>
        </Tooltip>

        <div className="flex items-end gap-2 px-2 pb-2 pt-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground">
            <Sparkles className="h-4 w-4" />
          </div>

          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={1}
            placeholder="Ask anything, or describe a recipe to build... (press / to focus)"
            aria-label="Prompt bar"
            disabled={isThinking}
            className="min-h-9 max-h-32 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
          />

          <Button
            type="submit"
            size="icon"
            disabled={!value.trim() || isThinking}
            className="h-9 w-9 shrink-0 rounded-xl bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40"
            aria-label={isThinking ? "Thinking" : "Send"}
          >
            {isThinking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
