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
import { useExecutionStore } from "@/lib/stores/execution-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

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
  const receipt = extractReceipt(result);
  const preflight = extractPreflightHealth(result);
  const isRunTool =
    call.toolName === "run_workflow" ||
    call.toolName === "run_from" ||
    call.toolName === "regenerate";
  const inFlight = result === undefined;
  return (
    <div className="flex flex-col gap-0.5">
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
      {/* ADR-0069 F23 — live engine progress while a run_* tool is in flight.
          The tool itself awaits completion (F14), so the chat would otherwise
          just show a spinner for several seconds with no signal. The inline
          progress chip subscribes to the execution store and updates per-node
          status in real time. */}
      {isRunTool && inFlight ? <RunProgressInline /> : null}
      {receipt ? (
        <ToolCallReceiptLine receipt={receipt} />
      ) : null}
      {preflight ? (
        <PreflightHealthChip preflight={preflight} />
      ) : null}
    </div>
  );
}

/**
 * RunProgressInline — ADR-0069 F23.
 *
 * Live per-node engine progress, rendered under a `run_workflow` /
 * `run_from` / `regenerate` ToolCallRow while the run is in flight.
 * Subscribes to the execution + workflow stores and aggregates the
 * status counts so the user sees something more useful than a bare
 * spinner during a 10-second run.
 *
 * The component shows three pieces of information:
 *   - "X / Y nodes complete" overall progress.
 *   - The currently-running node's id + kind ("running n5 [LLM Text]").
 *   - The most recent failed node, if any (red dot + id).
 *
 * Falls back to nothing when the store says we're not running — that
 * way the row collapses cleanly the moment the engine finishes, even
 * if the tool's result hasn't reached the chat yet.
 */
function RunProgressInline() {
  const isRunning = useExecutionStore((s) => s.isRunning);
  const records = useExecutionStore((s) => s.records);
  const totalNodes = useWorkflowStore((s) => s.nodes.length);

  if (!isRunning) return null;
  if (totalNodes === 0) return null;

  let done = 0;
  let cached = 0;
  let errored = 0;
  let runningId: string | null = null;
  let runningKind: string | null = null;
  let lastErrorId: string | null = null;
  for (const [nodeId, rec] of records) {
    if (rec.status === "done") done++;
    if (rec.status === "cached") cached++;
    if (rec.status === "error") {
      errored++;
      lastErrorId = nodeId;
    }
    if (rec.status === "running" && !runningId) {
      runningId = nodeId;
      const node = useWorkflowStore
        .getState()
        .nodes.find((n) => n.id === nodeId);
      runningKind = node?.kind ?? null;
    }
  }
  const completed = done + cached;
  return (
    <div
      data-testid="run-progress-inline"
      className="ml-5 flex flex-col gap-0.5 text-[10.5px] text-muted-foreground/85"
    >
      <div className="flex items-center gap-1.5">
        <Loader2 className="h-2.5 w-2.5 animate-spin text-emerald-500/80" />
        <span>
          <span className="font-mono text-foreground/85">
            {completed}
          </span>{" "}
          / {totalNodes} nodes complete
          {cached > 0 ? (
            <span className="text-muted-foreground/55"> ({cached} cached)</span>
          ) : null}
        </span>
      </div>
      {runningId ? (
        <div className="ml-4">
          running{" "}
          <span className="font-mono text-foreground/85">{runningId}</span>
          {runningKind ? (
            <span className="text-muted-foreground/65"> [{runningKind}]</span>
          ) : null}
        </div>
      ) : null}
      {errored > 0 && lastErrorId ? (
        <div className="ml-4 flex items-center gap-1 text-destructive/80">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive/80" />
          <span>
            {errored} error{errored === 1 ? "" : "s"} (latest:{" "}
            <span className="font-mono">{lastErrorId}</span>)
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Extract a structured receipt from a tool_result event. Returns
 * null when the tool didn't supply one (read tools, legacy tools,
 * etc.). The receipt object is the same shape the LLM consumes —
 * we just project it for the UI.
 *
 * Three shapes:
 *   - patch: `changed[]` of real keys + before/after maps.
 *   - create/delete: `changed: ["__create" | "__delete"]` + `entity`.
 *   - bulk: `changed: ["__bulk"]` + `bulk` counters.
 *   - no-op: `ok: false` with `attemptedPatch` (or matching error
 *     string) so the user sees the failed-but-not-fatal yellow path.
 */
function extractReceipt(
  result: ReasonerEvent | undefined,
): ToolCallReceipt | null {
  if (!result || result.type !== "tool_result") return null;
  const r = result.result as
    | {
        ok?: boolean;
        error?: string;
        changed?: string[];
        before?: Record<string, unknown>;
        after?: Record<string, unknown>;
        entity?: Record<string, unknown>;
        bulk?: Record<string, unknown>;
        attemptedPatch?: unknown;
        nodeId?: string;
        nodeKind?: string;
      }
    | null;
  if (!r || typeof r !== "object") return null;
  if (r.ok === false && typeof r.error === "string" && r.error.includes("no-op")) {
    return {
      kind: "noop",
      message: r.error,
      attemptedPatch: r.attemptedPatch,
      nodeId: r.nodeId,
      nodeKind: r.nodeKind,
    };
  }
  if (!Array.isArray(r.changed) || r.changed.length === 0) return null;
  if (r.changed[0] === "__create") {
    return { kind: "create", entity: r.entity ?? {} };
  }
  if (r.changed[0] === "__delete") {
    return { kind: "delete", entity: r.entity ?? {} };
  }
  if (r.changed[0] === "__bulk") {
    return { kind: "bulk", bulk: r.bulk ?? {} };
  }
  return {
    kind: "patch",
    changed: r.changed,
    before: r.before ?? {},
    after: r.after ?? {},
    nodeId: r.nodeId,
    nodeKind: r.nodeKind,
  };
}

type ToolCallReceipt =
  | {
      kind: "patch";
      changed: string[];
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      nodeId?: string;
      nodeKind?: string;
    }
  | { kind: "create"; entity: Record<string, unknown> }
  | { kind: "delete"; entity: Record<string, unknown> }
  | { kind: "bulk"; bulk: Record<string, unknown> }
  | {
      kind: "noop";
      message: string;
      attemptedPatch?: unknown;
      nodeId?: string;
      nodeKind?: string;
    };

function truncateForUi(value: unknown, max = 60): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") {
    const trimmed = value.length <= max ? value : value.slice(0, max - 3) + "...";
    return `"${trimmed}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

/**
 * Lookup the user-facing label for a node id from the workflow store.
 *
 * Returns the user-set `node.label` (preferred), or the schema title
 * for that kind, or `null` when the node was deleted before the receipt
 * rendered. Used by `PatchReceiptLine` so the user can confirm at a
 * glance which node a patch landed on, especially for duplicate-text
 * scenarios where two nodes share the same `config.text`.
 */
function lookupNodeLabel(
  nodeId: string | undefined,
  fallbackKind: string | undefined,
): { label?: string; title?: string } {
  if (!nodeId) {
    if (fallbackKind) return { title: fallbackKind };
    return {};
  }
  try {
    // Lazy require so server-rendered storyshots don't pull in zustand.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { useWorkflowStore } = require("@/lib/stores/workflow-store") as typeof import("@/lib/stores/workflow-store");
    const { nodeRegistry } = require("@/lib/engine/registry") as typeof import("@/lib/engine/registry");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) {
      if (fallbackKind) return { title: nodeRegistry.get(fallbackKind)?.title ?? fallbackKind };
      return {};
    }
    const schema = nodeRegistry.get(node.kind);
    return {
      label: node.label && node.label.trim().length > 0 ? node.label : undefined,
      title: schema?.title ?? node.kind,
    };
  } catch {
    if (fallbackKind) return { title: fallbackKind };
    return {};
  }
}

/**
 * Patch receipt — ADR-0069 F5.
 *
 * Renders `nodeId [Title · "Label"]: key  "before" → "after"` so the user
 * can immediately confirm:
 *   1. WHICH node was patched (id + title + optional user label) — the
 *      single most important upgrade over the pre-ADR-0069 receipt that
 *      only showed `key: "after"` and made duplicate-text scenarios
 *      indistinguishable from each other.
 *   2. WHAT changed (each key on its own line for multi-key patches).
 *   3. The before→after diff inline so the user can spot patches that
 *      landed on the wrong node by reading the "before" value.
 */
function PatchReceiptLine({
  receipt,
}: {
  receipt: Extract<ToolCallReceipt, { kind: "patch" }>;
}) {
  const { label, title } = lookupNodeLabel(receipt.nodeId, receipt.nodeKind);
  const titlePart = title ? ` [${title}${label ? ` · "${label}"` : ""}]` : "";
  const idPart = receipt.nodeId ?? "?";

  return (
    <div
      className="ml-9 flex flex-col gap-0.5 text-[10.5px] text-muted-foreground/80"
      data-testid="tool-call-receipt"
      data-receipt-kind="patch"
      data-receipt-node-id={receipt.nodeId ?? undefined}
    >
      <div>
        →{" "}
        <span className="font-mono text-foreground/85">
          {idPart}
        </span>
        <span className="text-muted-foreground/70">{titlePart}</span>
        :
      </div>
      {receipt.changed.map((key) => {
        const before = truncateForUi(receipt.before[key]);
        const after = truncateForUi(receipt.after[key]);
        return (
          <div
            key={key}
            className="ml-3 flex flex-wrap items-baseline gap-1 leading-snug"
            data-receipt-changed-key={key}
          >
            <span className="font-mono text-foreground/85">{key}</span>
            <span className="text-rose-600/80 dark:text-rose-400/80">
              {before}
            </span>
            <span className="text-muted-foreground/60">→</span>
            <span className="text-emerald-600/80 dark:text-emerald-400/80">
              {after}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ToolCallReceiptLine({ receipt }: { receipt: ToolCallReceipt }) {
  if (receipt.kind === "patch") {
    return <PatchReceiptLine receipt={receipt} />;
  }
  if (receipt.kind === "create") {
    const id = typeof receipt.entity.id === "string" ? receipt.entity.id : "?";
    const kind = typeof receipt.entity.kind === "string" ? receipt.entity.kind : "node";
    return (
      <div
        className="ml-9 text-[10.5px] text-emerald-600/80 dark:text-emerald-400/80"
        data-testid="tool-call-receipt"
        data-receipt-kind="create"
      >
        → +{id} ({kind})
      </div>
    );
  }
  if (receipt.kind === "delete") {
    const id = typeof receipt.entity.id === "string" ? receipt.entity.id : "?";
    const kind = typeof receipt.entity.kind === "string" ? receipt.entity.kind : "edge";
    return (
      <div
        className="ml-9 text-[10.5px] text-rose-600/80 dark:text-rose-400/80"
        data-testid="tool-call-receipt"
        data-receipt-kind="delete"
      >
        → −{id} ({kind})
      </div>
    );
  }
  if (receipt.kind === "bulk") {
    const parts = Object.entries(receipt.bulk)
      .filter(([, v]) => v !== null && v !== undefined && v !== 0 && v !== false)
      .map(([k, v]) => `${k}: ${truncateForUi(v, 40)}`)
      .join(", ");
    return (
      <div
        className="ml-9 text-[10.5px] text-muted-foreground/80"
        data-testid="tool-call-receipt"
        data-receipt-kind="bulk"
      >
        → {parts || "applied"}
      </div>
    );
  }
  return (
    <div
      className="ml-9 flex flex-col gap-0.5 text-[10.5px] text-amber-600/80 dark:text-amber-400/80"
      data-testid="tool-call-receipt"
      data-receipt-kind="noop"
      data-receipt-node-id={receipt.kind === "noop" ? receipt.nodeId : undefined}
    >
      <div>
        → no-op (config did not change)
        {receipt.kind === "noop" && receipt.nodeId ? (
          <>
            {" on "}
            <span className="font-mono text-foreground/80">{receipt.nodeId}</span>
          </>
        ) : null}
      </div>
      {receipt.kind === "noop" && receipt.attemptedPatch ? (
        <div className="ml-3 text-muted-foreground/70">
          attempted: {truncateForUi(receipt.attemptedPatch, 80)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Pre-flight health chip — rendered inline below ToolCallRow when
 * `__preflightHealth` is attached to a tool result. The reasoner
 * attaches this to the first structural write of a turn when the
 * live graph already has error-level issues; surfacing it here gives
 * the user a visible hook even if the LLM forgets to quote it.
 *
 * Uses native <details> for the accordion so we don't need extra
 * deps and keyboard a11y is free.
 */
type PreflightHealth = {
  note: string;
  issueCount: number;
  errorCount: number;
  issues: Array<{
    severity: "error" | "warn";
    code: string;
    nodeId?: string;
    edgeId?: string;
    message: string;
    hint?: string;
  }>;
};

function extractPreflightHealth(
  result: ReasonerEvent | undefined,
): PreflightHealth | null {
  if (!result || result.type !== "tool_result") return null;
  const r = result.result as { __preflightHealth?: unknown } | null;
  if (!r || typeof r !== "object") return null;
  const h = r.__preflightHealth as PreflightHealth | undefined;
  if (!h || typeof h !== "object" || !Array.isArray(h.issues)) return null;
  return h;
}

function PreflightHealthChip({ preflight }: { preflight: PreflightHealth }) {
  return (
    <details
      className="ml-9 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1"
      data-testid="tool-call-preflight"
    >
      <summary className="cursor-pointer text-[10.5px] font-medium text-amber-600 dark:text-amber-400">
        ⚠ {preflight.errorCount} error{preflight.errorCount === 1 ? "" : "s"} —
        preflight ({preflight.issueCount} total)
      </summary>
      <div className="mt-1 flex flex-col gap-1 text-[10.5px]">
        <p className="text-muted-foreground/90">{preflight.note}</p>
        <ul className="flex flex-col gap-1">
          {preflight.issues.map((issue, idx) => (
            <li
              key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? idx}`}
              className="rounded bg-amber-500/5 px-1.5 py-1"
              data-testid="tool-call-preflight-issue"
            >
              <code className="text-[10.5px] text-amber-700 dark:text-amber-300">
                {issue.severity}:{issue.code}
              </code>
              {issue.nodeId ? (
                <span className="ml-1.5 text-foreground/70">
                  {issue.nodeId}
                </span>
              ) : null}
              {issue.edgeId ? (
                <span className="ml-1.5 text-foreground/70">
                  edge {issue.edgeId}
                </span>
              ) : null}
              <p className="text-foreground/80">{issue.message}</p>
              {issue.hint ? (
                <p className="text-muted-foreground/80">→ {issue.hint}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </details>
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
  const contradictions = detectContradictions(message);
  return (
    <div className="flex flex-col gap-2">
      <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-foreground/5 px-3 py-2 text-sm text-foreground/90">
        {message.error ? (
          <p className="text-destructive/90" data-testid="assistant-error">
            {message.error}
          </p>
        ) : message.plan ? (
          <PlanCard plan={message.plan} />
        ) : message.question ? (
          <PersistedQuestionCard
            question={message.question.question}
            options={message.question.options}
          />
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}
      </div>
      {contradictions.length > 0 ? (
        <ContradictionBanner reasons={contradictions} />
      ) : null}
      {message.toolReceipts && message.toolReceipts.length > 0 ? (
        <PersistedToolReceiptsBlock receipts={message.toolReceipts} />
      ) : null}
      {message.costUsd !== undefined ? (
        <span className="text-[10px] text-muted-foreground/60">
          {message.costUsd.toFixed(4)} USD
        </span>
      ) : null}
    </div>
  );
}

/**
 * ADR-0069 F22 — contradiction detection.
 *
 * Cheap heuristic that flags when the assistant's chat text claims an
 * action but the corresponding tool receipt isn't present. Two
 * patterns matter:
 *
 *   1. RUN claim with no run tool. The LLM says "rodei / executei /
 *      regenerated / I'm running …" but `run_workflow` /
 *      `run_from` / `regenerate` never fired this turn.
 *   2. CHANGE claim with no mutation tool. The LLM says "mudei /
 *      atualizei / changed / set …" but `update_node_config` /
 *      `add_node` / `add_edge` / `remove_*` / similar never fired.
 *
 * Both are conservative: we only flag pretérito perfeito + present-
 * progressive ("I'm running") past-tense claims, not future ("I'll
 * run when you click"). Negations are heuristically suppressed
 * ("I didn't run", "não rodei").
 *
 * False positive cost: the user sees an extra "verify the canvas"
 * banner. False negative cost: the user trusts a phantom claim and
 * burns time debugging an unchanged node. We optimise for the
 * latter.
 */
const RUN_CLAIM_RE =
  /\b(ran|running|executed|regenerated|kicked off|rodei|rodando|executei|gerei|regenerei|comecei|iniciei|started)\b/i;
const CHANGE_CLAIM_RE =
  /\b(changed|updated|modified|patched|set to|connected|wired|alterei|mudei|atualizei|modifiquei|coloquei|defini|conectei|liguei)\b/i;
const NEGATION_RE =
  /\b(didn'?t|didnt|did not|won'?t|will not|no longer|não|nao|sem)\s+(\w+\s+)?(run|change|update|patch|connect|rodei|mudei|alterei|atualizei|conectei|liguei)\b/i;
const RUN_TOOLS = new Set(["run_workflow", "run_from", "regenerate"]);
const MUTATION_TOOLS = new Set([
  "update_node_config",
  "add_node",
  "remove_node",
  "add_edge",
  "remove_edge",
  "move_node",
  "instantiate_recipe",
  "regenerate",
  "diff_config",
]);

function detectContradictions(message: AssistantMessage): string[] {
  // Skip when the message has no plain text claim to compare against.
  if (message.error) return [];
  if (message.plan) return [];
  if (message.question) return [];
  const text = (message.content ?? "").trim();
  if (text.length === 0) return [];
  // Negation early-out: if the message contains explicit negation
  // matching the verbs we look for, skip detection — false positives
  // there would erode trust in the banner.
  if (NEGATION_RE.test(text)) return [];

  const tools = new Set(
    (message.toolReceipts ?? []).map((r) => r.tool).filter(Boolean),
  );
  const reasons: string[] = [];

  if (RUN_CLAIM_RE.test(text)) {
    const ranSomething = Array.from(RUN_TOOLS).some((t) => tools.has(t));
    if (!ranSomething) {
      reasons.push(
        "Mensagem afirma execução, mas nenhum run_workflow / run_from / regenerate foi chamado neste turno.",
      );
    }
  }
  if (CHANGE_CLAIM_RE.test(text)) {
    const mutated = Array.from(MUTATION_TOOLS).some((t) => tools.has(t));
    if (!mutated) {
      reasons.push(
        "Mensagem afirma alteração, mas nenhum tool de escrita (update_node_config, add_node, add_edge, …) foi chamado neste turno.",
      );
    }
  }
  return reasons;
}

function ContradictionBanner({ reasons }: { reasons: string[] }) {
  return (
    <div
      data-testid="contradiction-banner"
      className="ml-2 max-w-[80%] rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200/95"
    >
      <p className="mb-1 font-medium uppercase tracking-wide text-amber-200/80">
        verifique antes de confiar
      </p>
      <ul className="ml-3 list-disc space-y-0.5">
        {reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * PersistedQuestionCard — ADR-0069 F11.
 *
 * Renders an ask_user question that's been persisted to history. Mirrors
 * the live `PendingQuestionCard` styling but read-only — clicking an
 * option in the past doesn't make sense (the user has already moved on),
 * so we render options as static chips for context only.
 */
function PersistedQuestionCard({
  question,
  options,
}: {
  question: string;
  options?: string[];
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="persisted-question">
      <p className="text-foreground/85 italic">{question}</p>
      {options && options.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {options.map((opt) => (
            <span
              key={opt}
              className="rounded-md border border-border/40 bg-background/40 px-2 py-0.5 text-[10.5px] text-muted-foreground/80"
            >
              {opt}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * PersistedToolReceiptsBlock — ADR-0069 F10.
 *
 * Renders the `toolReceipts` array attached to a persisted assistant
 * message. Mirrors the live-trace rendering for the SAME tool dispatch
 * that produced these receipts, so a user scrolling back in history
 * sees the same `→ nodeId [Title]: key  "before" → "after"` lines they
 * saw at the moment the assistant ran.
 *
 * Collapsed by default behind a "N tool call(s)" summary so the chat
 * sheet doesn't get visually noisy in long histories. Click expands.
 */
function PersistedToolReceiptsBlock({
  receipts,
}: {
  receipts: NonNullable<AssistantMessage["toolReceipts"]>;
}) {
  if (receipts.length === 0) return null;
  const summary = summarizeReceiptsForTurn(receipts);
  return (
    <details
      className="ml-2 max-w-[80%] text-[10.5px] text-muted-foreground/85"
      data-testid="persisted-tool-receipts"
    >
      <summary className="cursor-pointer select-none text-muted-foreground/70 transition-colors hover:text-muted-foreground">
        ▸ <span className="font-medium">Run summary</span>{" "}
        <span className="text-muted-foreground/55">·</span>{" "}
        <span data-testid="run-summary-line">{summary}</span>
      </summary>
      <div className="mt-1 flex flex-col gap-1 border-l border-border/40 pl-2">
        {receipts.map((r) => (
          <div
            key={r.callId}
            className="flex flex-col gap-0.5"
            data-testid="persisted-tool-receipt"
          >
            <div className="flex items-center gap-1.5 text-foreground/80">
              <Wrench className="h-3 w-3 text-muted-foreground/60" />
              <code className="font-mono text-foreground/85">{r.tool}</code>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-muted-foreground/60">
                {r.durationMs}ms
              </span>
            </div>
            {(() => {
              const synth = synthesizeReceipt(r.result);
              return synth ? (
                <ToolCallReceiptLine receipt={synth} />
              ) : null;
            })()}
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * ADR-0069 F24 — turn summary line for the persisted receipts block.
 *
 * Aggregates the per-tool receipts into a single human-readable line
 * the user can scan without expanding the full list. Bucketed by:
 *   - mutations (update_node_config, add_node, add_edge, remove_*,
 *     move_node, instantiate_recipe — the writes that change canvas
 *     state),
 *   - runs (run_workflow / run_from / regenerate, with totalCostUsd
 *     and node-completion counts pulled from each call's structured
 *     result),
 *   - reads (everything else — usually read_canvas, read_node_state).
 *
 * Falls back to a generic "N tool calls" string for receipts whose
 * shape we don't recognise. Keeps the line short — long surfaces look
 * cluttered against the muted-foreground baseline.
 */
function summarizeReceiptsForTurn(
  receipts: NonNullable<AssistantMessage["toolReceipts"]>,
): string {
  let mutations = 0;
  let runs = 0;
  let runNodesDone = 0;
  let runErrors = 0;
  let runCostUsd = 0;
  let reads = 0;
  let proposed = 0;

  const MUTATION = new Set([
    "update_node_config",
    "add_node",
    "remove_node",
    "add_edge",
    "remove_edge",
    "move_node",
    "instantiate_recipe",
    "diff_config",
  ]);
  const RUN = new Set(["run_workflow", "run_from", "regenerate"]);

  for (const r of receipts) {
    if (RUN.has(r.tool)) {
      runs++;
      const res = r.result as
        | {
            nodeSummary?: Array<{ status?: string }>;
            errors?: Array<unknown>;
            totalCostUsd?: number;
          }
        | undefined;
      if (res && Array.isArray(res.nodeSummary)) {
        runNodesDone += res.nodeSummary.filter(
          (n) => n.status === "done" || n.status === "cached",
        ).length;
      }
      if (res && Array.isArray(res.errors)) runErrors += res.errors.length;
      if (res && typeof res.totalCostUsd === "number") {
        runCostUsd += res.totalCostUsd;
      }
    } else if (r.tool === "propose_refactor") {
      proposed++;
    } else if (MUTATION.has(r.tool)) {
      mutations++;
    } else {
      reads++;
    }
  }
  const parts: string[] = [];
  if (mutations > 0) parts.push(`${mutations} mutation${mutations === 1 ? "" : "s"}`);
  if (runs > 0) {
    const runDetails: string[] = [`${runNodesDone} done`];
    if (runErrors > 0) runDetails.push(`${runErrors} error${runErrors === 1 ? "" : "s"}`);
    if (runCostUsd > 0) runDetails.push(`$${runCostUsd.toFixed(4)}`);
    parts.push(
      `${runs} run${runs === 1 ? "" : "s"} (${runDetails.join(", ")})`,
    );
  }
  if (proposed > 0) parts.push(`${proposed} refactor queued`);
  if (reads > 0) parts.push(`${reads} read${reads === 1 ? "" : "s"}`);
  if (parts.length === 0) {
    return `${receipts.length} tool call${receipts.length === 1 ? "" : "s"}`;
  }
  return parts.join(" · ");
}

/**
 * Reuse the live-trace `extractReceipt` projection logic by simulating
 * the `tool_result` event shape it expects. Keeps a single source of
 * truth for receipt rendering between live and persisted paths.
 */
function synthesizeReceipt(result: unknown): ToolCallReceipt | null {
  return extractReceipt({
    type: "tool_result",
    toolName: "_persisted",
    callId: "_persisted",
    durationMs: 0,
    result,
  } as ReasonerEvent);
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
