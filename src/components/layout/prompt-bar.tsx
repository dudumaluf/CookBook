"use client";

import {
  ArrowUp,
  AtSign,
  ChevronDown,
  ChevronUp,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatSheet } from "./chat-sheet";
import { RefactorPreviewModal } from "@/components/assistant/refactor-preview-modal";
import { PromptReferencePicker } from "./prompt-reference-picker";
import { useSession } from "@/lib/auth/use-session";
import { runReasoner } from "@/lib/assistant/reasoner";
import type { PromptReference } from "@/lib/assistant/prompt-references";
import { attachFileAsReference } from "@/lib/library/attach-file";
import { nodeRegistry } from "@/lib/engine/registry";
import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";
import { persistMessage } from "@/lib/sync/chat-sync";
import { useAssistantSettingsStore } from "@/lib/stores/assistant-settings-store";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

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
  const [references, setReferences] = useState<PromptReference[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  function addReference(ref: PromptReference) {
    setReferences((curr) =>
      curr.some((r) => r.refId === ref.refId) ? curr : [...curr, ref],
    );
  }

  function removeReference(id: string) {
    setReferences((curr) => curr.filter((r) => r.id !== id));
  }

  function renameReference(ref: PromptReference, label: string) {
    const next = label.trim();
    if (!next) return;
    setReferences((curr) =>
      curr.map((r) => (r.id === ref.id ? { ...r, label: next } : r)),
    );
    // Persist the rename to the source so it's findable later.
    if (ref.kind === "asset") {
      const store = useAssetStore.getState();
      const asset = store.getAsset(ref.refId);
      if (asset?.kind === "asset-group") store.renameGroup(ref.refId, next);
      else store.updateAsset(ref.refId, { name: next });
    } else {
      void getGenerationRepository().setTitle(ref.refId, next);
    }
  }

  async function addFiles(files: File[]) {
    for (const file of files) {
      try {
        const ref = await attachFileAsReference(file);
        if (ref) addReference(ref);
        else toast.error(`Unsupported file: ${file.name}`);
      } catch (err) {
        console.warn("[prompt-bar] attach failed:", err);
        toast.error(`Could not attach ${file.name}`);
      }
    }
  }

  function handlePickReference(ref: PromptReference) {
    addReference(ref);
    setPickerOpen(false);
    // Strip a trailing "@query" token the user may have typed to open the menu.
    setValue((v) => v.replace(/@[^\s@]*$/, ""));
    inputRef.current?.focus();
  }

  async function handleSubmit() {
    const text = value.trim();
    if (!text || isThinking || !user) return;
    if (!projectId) {
      toast.error("No active project. Wait for cloud sync to load.");
      return;
    }
    setValue("");
    setReferences([]);
    setPickerOpen(false);
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
    // Slice 0 — read the user's selected model on submit so we always
    // pick up the freshest setting (the picker may have been changed
    // mid-thought). `getModel()` falls back to the default when the
    // persisted value is empty / missing, so we never hand the
    // reasoner a blank id.
    const selectedModel = useAssistantSettingsStore.getState().getModel();
    try {
      // Slice 7.3 — runReasoner replaces the one-shot planFromAssistant.
      // Tool calls dispatch live; we render the trace via onEvent and
      // persist only the final assistant message.
      const result = await runReasoner({
        userMessage: text,
        ...(references.length ? { references } : {}),
        ownerId: user.id,
        projectId,
        signal: controller.signal,
        model: selectedModel,
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
            : result.paused
              ? "(awaiting your reply)"
              : "(no response)";
      // ADR-0069 F10 — capture every tool result emitted during this
      // turn so the chat history retains the full audit trail. Without
      // this, the assistant's prose is the only artifact that survives
      // reload — tool calls + receipts (the structured proof of what
      // changed) are dropped on `resetLive()` next submit.
      const toolReceipts = result.events
        .filter(
          (e): e is Extract<typeof e, { type: "tool_result" }> =>
            e.type === "tool_result",
        )
        .map((e) => ({
          tool: e.toolName,
          callId: e.callId,
          durationMs: e.durationMs,
          result: e.result,
        }));
      // ADR-0069 F11 — capture the ask_user question so the persisted
      // assistant message tells future renderings (and future LLM
      // turns reading history) what was asked. Without this, the turn
      // persists as "(no response)" with no record of the question
      // and the LLM can't connect the user's reply to its own ask_user.
      const lastAskUser = [...result.events]
        .reverse()
        .find(
          (e): e is Extract<typeof e, { type: "ask_user" }> =>
            e.type === "ask_user",
        );
      const question =
        result.paused && lastAskUser
          ? {
              question: lastAskUser.question,
              ...(lastAskUser.options
                ? { options: lastAskUser.options }
                : {}),
            }
          : undefined;
      const assistantMsg = {
        role: "assistant" as const,
        content: finalContent,
        ...(result.totalCostUsd > 0
          ? { costUsd: result.totalCostUsd }
          : {}),
        ...(toolReceipts.length > 0 ? { toolReceipts } : {}),
        ...(question ? { question } : {}),
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

      <RefactorPreviewModal />

      <AnchorBadge />

      {pickerOpen ? (
        <div className="pointer-events-auto">
          <PromptReferencePicker
            query=""
            onPick={handlePickReference}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void addFiles(files);
        }}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer.files);
          if (files.length) {
            e.preventDefault();
            void addFiles(files);
          }
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

        {references.length > 0 ? (
          <div
            data-testid="prompt-reference-chips"
            className="flex flex-wrap gap-1.5 px-3 pb-0.5 pt-1.5"
          >
            {references.map((ref) => (
              <ReferenceChip
                key={ref.id}
                reference={ref}
                onRemove={() => removeReference(ref.id)}
                onRename={(label) => renameReference(ref, label)}
              />
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-1 px-2 pb-2 pt-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Attach files"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Attach files</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Reference an asset or result"
                onClick={() => setPickerOpen((o) => !o)}
                aria-pressed={pickerOpen}
                className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <AtSign className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Reference (@) Library or Gallery</TooltipContent>
          </Tooltip>

          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => {
              const next = e.target.value;
              // Typing "@" opens the reference picker.
              if (next.length > value.length && next.endsWith("@")) {
                setPickerOpen(true);
              }
              setValue(next);
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            rows={1}
            placeholder="Ask, describe a workflow, drop files, or @ to reference… (/ to focus)"
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

/** Attachment / @-mention chip above the prompt input. Click the name to
 *  rename (renames the underlying asset/generation too); X removes it. */
function ReferenceChip({
  reference,
  onRemove,
  onRename,
}: {
  reference: PromptReference;
  onRemove: () => void;
  onRename: (label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(reference.label);
  return (
    <span
      data-testid="prompt-reference-chip"
      className="group/chip inline-flex max-w-[200px] items-center gap-1 rounded-md border border-border/60 bg-background/60 py-0.5 pl-1 pr-0.5 text-[11px]"
    >
      {reference.url && reference.mediaType === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reference.url}
          alt=""
          className="h-4 w-4 shrink-0 rounded object-cover"
        />
      ) : null}
      {editing ? (
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => {
            setEditing(false);
            onRename(val);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setEditing(false);
              onRename(val);
            }
            if (e.key === "Escape") {
              setEditing(false);
              setVal(reference.label);
            }
          }}
          className="w-24 bg-transparent text-foreground outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setVal(reference.label);
            setEditing(true);
          }}
          title="Click to rename"
          className="truncate text-foreground/85"
        >
          {reference.label}
        </button>
      )}
      <button
        type="button"
        aria-label={`Remove ${reference.label}`}
        onClick={onRemove}
        className="shrink-0 rounded text-muted-foreground/60 hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/**
 * AnchorBadge — ADR-0070.
 *
 * Always-visible chip just above the prompt that mirrors what the
 * assistant will treat as the deictic anchor ("this/that/it/isso") in
 * the next request:
 *
 *   - 1 node selected → `📌 text_xyz · "Subject" [Text]` (the EXACT id
 *     the LLM will see in `## FOCUSED NODE`)
 *   - 2+ nodes        → `📌 N selected — assistant will treat as group`
 *   - 0 selected      → nothing (no chip, no whitespace) so the prompt
 *     surface stays clean when there's no anchor to communicate
 *
 * The user reported that the assistant kept claiming changes that
 * didn't land — typically because their selection was lost between
 * highlight and submit. The badge collapses that ambiguity into a
 * single glance: if the badge doesn't say what you expected, fix the
 * selection BEFORE pressing enter.
 *
 * Visual: small pill, accent-tinted, sits flush with the prompt's
 * width so it reads as part of the same surface. Wraps gracefully on
 * narrow viewports. Click selects + scrolls the canvas to the node
 * (matches ADR-0070's auto-pan flow on receipts).
 */
function AnchorBadge() {
  const selectedNodeIds = useWorkflowStore((s) => s.selectedNodeIds);

  if (selectedNodeIds.length === 0) return null;

  return (
    <div
      data-testid="anchor-badge"
      className="pointer-events-auto mx-auto flex w-full max-w-[640px] items-center justify-start"
    >
      {selectedNodeIds.length === 1 ? (
        <SingleAnchorChip nodeId={selectedNodeIds[0]!} />
      ) : (
        <MultiAnchorChip count={selectedNodeIds.length} />
      )}
    </div>
  );
}

function SingleAnchorChip({ nodeId }: { nodeId: string }) {
  const node = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId));
  if (!node) return null;
  const schema = nodeRegistry.get(node.kind);
  const title = schema?.title ?? node.kind;
  const label = node.label && node.label.trim().length > 0 ? node.label : null;
  return (
    <span
      data-testid="anchor-badge-single"
      data-anchor-node-id={nodeId}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[10.5px] text-accent-foreground/90 shadow-sm"
    >
      <span aria-hidden className="text-accent">
        ◆
      </span>
      <span className="font-mono text-foreground/85">{nodeId}</span>
      <span className="text-muted-foreground/80">·</span>
      <span className="truncate text-foreground/75">
        {label ? `"${label}" / ${title}` : title}
      </span>
      <span className="ml-1 text-muted-foreground/60">
        — assistant will treat as &quot;this/that/it/isso&quot;
      </span>
    </span>
  );
}

function MultiAnchorChip({ count }: { count: number }) {
  return (
    <span
      data-testid="anchor-badge-multi"
      className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[10.5px] text-accent-foreground/90 shadow-sm"
    >
      <span aria-hidden className="text-accent">
        ◆
      </span>
      <span className="text-foreground/85">{count} nodes selected</span>
      <span className="ml-1 text-muted-foreground/60">
        — assistant will treat as the selection set
      </span>
    </span>
  );
}
