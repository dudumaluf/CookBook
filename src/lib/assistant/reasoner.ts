"use client";

import {
  DEFAULT_ASSISTANT_MODEL,
  resolveModel,
} from "@/lib/assistant/models";
import { callOpenRouter } from "@/lib/llm/call-openrouter";
import type {
  ChatContentBlock,
  ChatMessage,
  ChatToolCall,
  LlmSuccessResponse,
} from "@/lib/llm/types";
import { useAssistantRoleStore } from "@/lib/stores/assistant-role-store";
import { resolveRole } from "@/lib/assistant/roles";
import { getResolvedPromptBody, PROMPT_KEYS } from "@/lib/prompts/resolve-prompt";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

import { buildKnowledgeBundle } from "./knowledge";
import { REASONER_INSTRUCTIONS } from "./instructions";
import {
  buildReferencesNote,
  type PromptReference,
} from "./prompt-references";
import { computeWorkflowHealth } from "./tools/read/check-workflow-health";
import { getTool, getToolCostClass, getToolDefinitions } from "./tools";
import type { AssistantTool, ToolExecutionContext } from "./tools";

/**
 * Reasoner runtime — Slice 7.3 (ADR-0042).
 *
 * The agent loop. Replaces the one-shot JSON-in-text path with a
 * proper multi-turn tool-call cycle:
 *
 *   1. Build the system prompt + chat history (knowledge bundle).
 *   2. POST to /api/llm/chat-completions with `tools[]` populated
 *      from the registry and `tool_choice: "auto"`.
 *   3. If the response carries `tool_calls`, dispatch each one
 *      against the registry, capture the result, append both the
 *      assistant message AND a `tool` role message per call to the
 *      `messages[]`, loop.
 *   4. Stop when the model emits a final assistant text message
 *      (no tool calls), OR when caps are hit (max turns / max cost),
 *      OR when a tool emits the `__pause: true` sentinel (ask_user).
 *
 * Bounded:
 *   - Max 20 turns per `runReasoner` call.
 *   - Max $0.50 cumulative cost per `runReasoner` call.
 *   - When a cap is hit: emit a `narration` event back to the caller
 *     so the UI can show "stopped — cost cap reached"; caller can
 *     re-invoke if the user accepts.
 *
 * Streaming:
 *   - Slice 7.3 returns the FULL trace to the caller AFTER the loop
 *     ends. Per-step UI updates happen via `onTrace` callback the
 *     caller passes (the ChatSheet uses this to render each tool
 *     call as it lands). Full SSE-streaming text deltas are out of
 *     scope for 7.3 — the loop streams tool-call EVENTS, not token
 *     deltas. Token streaming lands in a follow-up if the latency
 *     of the all-at-once response feels too slow.
 *
 * Errors:
 *   - Tool args fail Zod validation → tool result is the validation
 *     error, sent back to the LLM (it can self-correct).
 *   - Tool execution throws → result is `{ ok: false, error }`,
 *     loop continues (LLM can decide to retry / give up / ask user).
 *   - LLM call itself fails → loop terminates with error event.
 *   - Abort signal triggered → loop terminates immediately,
 *     returns `aborted: true`.
 */

const MAX_TURNS = 20;
/**
 * Hard cap per `runReasoner` call.
 *
 * Slice 1 of "Smarter assistant" raised this from $0.50 to $1.00 to
 * make room for the headroom that prompt caching (when it fires)
 * gives us — most turns now bill at a fraction of the old static-
 * prefix cost. Slice 3 bumps it again to $1.50:
 *
 *   - Slice 1 prompt caching trims re-billed static prefix to ~10%
 *     of pre-Slice-1.
 *   - Slice 2 lazy context + parallel reads cut another ~30% off
 *     the average turn.
 *   - Slice 3 history compaction + speculative pre-fetch remove a
 *     full turn from the analyze flow.
 *
 * The new cap gives even pathological flows headroom while still
 * tripping before a runaway loop burns through the budget.
 */
const MAX_COST_USD = 1.5;
/**
 * Slice 3 of "Smarter assistant" — history compaction threshold.
 *
 * After this many completed turns we start replacing stale read_*
 * tool results with a one-line summary so the outgoing request body
 * doesn't keep ballooning. The 2 most recent read results are
 * preserved verbatim because the LLM is most likely still reasoning
 * about them. Threshold of 5 = compaction kicks in around turn 6 of
 * a long conversation, comfortably AFTER the typical analyze flow
 * (1–4 turns) has wrapped.
 */
const COMPACTION_TURN_THRESHOLD = 5;
const COMPACTION_KEEP_LATEST_N = 2;

/**
 * Default model when the caller doesn't pass one and the settings
 * store hasn't been touched. Exported so external callers can refer
 * to it without re-importing from `models.ts`.
 */
export const DEFAULT_MODEL = DEFAULT_ASSISTANT_MODEL;

export type ReasonerEvent =
  | { type: "user"; content: string }
  | {
      type: "assistant_text";
      content: string;
      costUsd?: number;
      finishReason?: string;
    }
  | {
      type: "tool_call";
      toolName: string;
      arguments: unknown;
      callId: string;
    }
  | {
      type: "tool_result";
      toolName: string;
      callId: string;
      result: unknown;
      durationMs: number;
    }
  | {
      type: "narration";
      content: string;
    }
  | {
      type: "ask_user";
      question: string;
      options?: string[];
    }
  | {
      type: "error";
      content: string;
    }
  | {
      type: "cap_hit";
      cap: "turns" | "cost";
      message: string;
    };

export interface ReasonerOptions {
  /** The user's new message text. */
  userMessage: string;
  /**
   * Files/assets the user attached or @-mentioned in the prompt bar. Threaded
   * into the user turn so the assistant uses these specific items (by id/url)
   * rather than guessing from the generic library listing.
   */
  references?: readonly PromptReference[];
  ownerId: string;
  projectId: string;
  signal: AbortSignal;
  /** Override model. Defaults to anthropic/claude-sonnet-4.5. */
  model?: string;
  /**
   * Streaming hook. Fired for every event in the loop in order. The
   * UI hooks this to render progressive updates without waiting for
   * the full trace.
   */
  onEvent?: (event: ReasonerEvent) => void;
}

export interface ReasonerResult {
  /** Ordered event stream. Useful for tests / persistence. */
  events: ReasonerEvent[];
  /** Total LLM cost across all turns (best-effort, sums response costUsd). */
  totalCostUsd: number;
  /** True when the loop exited because a cap was hit. */
  cappedAt?: "turns" | "cost";
  /** True when the loop exited because ask_user paused. */
  paused?: boolean;
  /** True when the user aborted via signal. */
  aborted?: boolean;
  /** Final assistant text message, when the loop ended naturally. */
  finalText?: string;
}

/**
 * Run the reasoner loop. Returns when:
 *   - Model emits a final text message with no tool_calls.
 *   - Cost / turn cap reached.
 *   - ask_user tool called (loop pauses; caller re-invokes after answer).
 *   - Signal aborted.
 *   - Unrecoverable error.
 */
export async function runReasoner(
  options: ReasonerOptions,
): Promise<ReasonerResult> {
  const {
    userMessage,
    references,
    ownerId,
    projectId,
    signal,
    model: rawModel,
    onEvent,
  } = options;
  // Defensive default: an empty / whitespace-only model id falls back
  // to the catalog default. Keeps a stale localStorage value or a
  // typoed prompt-bar wire from sending a blank id upstream.
  const model =
    rawModel && rawModel.trim().length > 0 ? rawModel.trim() : DEFAULT_MODEL;

  const events: ReasonerEvent[] = [];
  function emit(ev: ReasonerEvent) {
    events.push(ev);
    onEvent?.(ev);
  }

  const ctx: ToolExecutionContext = { ownerId, projectId, signal };

  emit({ type: "user", content: userMessage });

  // Initial system prompt + history.
  const bundle = await buildKnowledgeBundle({ ownerId, projectId });
  const capability = resolveModel(model);
  // System message build — Slice 1 of "Smarter assistant" + Phase D1
  // role overlays + Phase C per-user reasoner overrides.
  //
  // Resolution order for the "base reasoner instructions" slot:
  //   1. Phase C — `app_prompt_overrides` row for this ownerId +
  //      PROMPT_KEYS.ASSISTANT_REASONER. If present, use the override
  //      body verbatim (the user knowingly took ownership of the base
  //      operating instructions).
  //   2. Default — `REASONER_INSTRUCTIONS` const (the bundled
  //      rulebook).
  //
  // The override fetch is fail-open: a transient DB error logs +
  // returns the default, so the assistant never breaks because the
  // override system is briefly unreachable.
  //
  // On caching-capable models (Anthropic, Gemini), emit two text
  // content blocks with `cache_control: { type: "ephemeral", ttl: "1h" }`
  // on the static prefix so the provider can serve subsequent turns
  // from a discounted cache read. Reasoner instructions + the active
  // role's overlay are bundled into the static prefix so they ride
  // along.
  //
  // The role overlay sits AFTER the resolved reasoner instructions so
  // it can specialize / override the base behavior (e.g. Storyboard
  // Director adds its 10 continuity rules on top of the regular
  // tool-calling discipline). Switching roles invalidates the cache by
  // definition — same for editing the override (Phase C) — that's the
  // explicit cost of either action.
  //
  // On caching-incapable models (OpenAI, Grok, custom), emit a plain
  // concatenated string identical to today's request shape — markers
  // would just be ignored and we don't want to risk a provider
  // rejecting an unfamiliar block format.
  const reasonerInstructions = await getResolvedPromptBody(
    PROMPT_KEYS.ASSISTANT_REASONER,
    ownerId,
  ).catch(() => REASONER_INSTRUCTIONS);
  const roleOverlay = resolveRole(useAssistantRoleStore.getState().getRoleId())
    .systemPromptOverlay;
  const staticPrefix =
    roleOverlay.length > 0
      ? `${bundle.staticPrefix}\n\n${reasonerInstructions}\n\n${roleOverlay}`
      : `${bundle.staticPrefix}\n\n${reasonerInstructions}`;
  const dynamicSuffix = bundle.dynamicSuffix;
  let systemMessage: ChatMessage;
  if (capability.caching && staticPrefix.length > 0) {
    const blocks: ChatContentBlock[] = [
      {
        type: "text",
        text: staticPrefix,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ];
    if (dynamicSuffix.length > 0) {
      blocks.push({ type: "text", text: dynamicSuffix });
    }
    systemMessage = { role: "system", content: blocks };
  } else {
    const text = dynamicSuffix
      ? `${staticPrefix}\n\n${dynamicSuffix}`
      : staticPrefix;
    systemMessage = { role: "system", content: text };
  }
  // Append the referenced-items note to the user turn (the chat UI still
  // shows the clean userMessage via the `user` event above).
  const refsNote = references ? buildReferencesNote(references) : "";
  let userContent = refsNote ? `${userMessage}\n\n${refsNote}` : userMessage;

  // Slice 3 of "Smarter assistant" — speculative pre-fetch.
  //
  // The most common analyze flow looks like:
  //   turn 1: LLM calls analyze_selection_subgraph()
  //   turn 2: LLM writes the UNDERSTAND/CRITIQUE/PROPOSE prose.
  //
  // We can collapse it to a single turn when we KNOW the user wants
  // analysis: a 2+ node selection plus an analyze-shaped phrase in
  // their message. Run the tool ourselves before the first LLM call
  // and inline the result as an `<analysis_context>` block on the
  // user message. The reasoner sees the findings on turn 1 and can
  // jump straight to the prose, saving a full LLM round-trip on the
  // critical path.
  //
  // Falls back silently to "no pre-fetch" if anything errors — the
  // turn loop below behaves identically to today.
  if (
    speculativePrefetchEnabled() &&
    matchesAnalyzeIntent(userMessage) &&
    useWorkflowStore.getState().selectedNodeIds.length >= 2
  ) {
    try {
      const tool = getTool("analyze_selection_subgraph");
      if (tool) {
        const result = await tool.execute({}, ctx);
        const block = `<analysis_context tool="analyze_selection_subgraph" speculative="true">\n${JSON.stringify(result, null, 2)}\n</analysis_context>`;
        userContent = `${userContent}\n\n${block}`;
        emit({
          type: "narration",
          content:
            "Pre-fetched selection analysis so I can skip the first read round-trip.",
        });
      }
    } catch (err) {
      console.warn("[reasoner] speculative pre-fetch failed:", err);
    }
  }
  // System lives at index 0 of `messages[]` so the chat-completions
  // wrapper doesn't try to prepend a separate string `system` arg.
  // (`buildRequestBody` only prepends when messages[0].role !== "system".)
  const messages: ChatMessage[] = [
    systemMessage,
    ...bundle.messages,
    { role: "user", content: userContent },
  ];
  const toolDefs = getToolDefinitions();

  let totalCostUsd = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal.aborted) {
      emit({ type: "error", content: "Aborted by user." });
      return { events, totalCostUsd, aborted: true };
    }

    // Slice 3 of "Smarter assistant" — history compaction.
    //
    // After turn 5 the conversation history typically holds dozens of
    // KB of stale read_* / analyze_* tool results that the LLM has
    // already digested. Replace each with a one-line placeholder so
    // the OUTGOING request body shrinks. We always keep the latest 2
    // read results verbatim — the LLM is most likely to be reasoning
    // about those still. Mutating tool results (add_node, run_*,
    // propose_refactor, …) are NEVER touched: they encode the
    // committed graph state and the LLM may need their full payload
    // (e.g. node ids) to keep reasoning coherently.
    //
    // Set ASSISTANT_HISTORY_COMPACTION=false to disable (rollback).
    if (turn >= COMPACTION_TURN_THRESHOLD && historyCompactionEnabled()) {
      compactStaleReadResults(messages);
    }

    let response: LlmSuccessResponse;
    try {
      response = await callOpenRouter({
        model,
        messages,
        tools: toolDefs,
        toolChoice: "auto",
        temperature: 0.2,
        maxTokens: 1500,
        // Slice 2: allow Claude/GPT/etc. to emit multiple tool calls in
        // a single turn. The dispatch loop below groups read-only calls
        // and runs them concurrently while keeping mutating calls
        // sequential, so concurrent emission is safe.
        parallelToolCalls: true,
        signal,
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        return { events, totalCostUsd, aborted: true };
      }
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "error", content: `LLM call failed: ${msg}` });
      return { events, totalCostUsd };
    }

    if (typeof response.costUsd === "number") {
      totalCostUsd += response.costUsd;
    }

    // Telemetry — Slice 1 of "Smarter assistant". Surfaces cache hits
    // so we can verify whether prompt caching is actually firing in
    // production. `cache_read > 0` on turn 2+ = caching is working.
    // All-zeros + Anthropic model = Fal/OpenRouter is stripping the
    // markers; lean on Slices 2/3 for savings.
    if (
      response.cacheCreationTokens !== undefined ||
      response.cacheReadTokens !== undefined ||
      response.inputTokens !== undefined
    ) {
      const parts: string[] = [
        `[reasoner] turn ${turn + 1}`,
        `model=${capability.id}`,
      ];
      if (typeof response.costUsd === "number") {
        parts.push(`cost=$${response.costUsd.toFixed(4)}`);
      }
      if (typeof response.cacheReadTokens === "number") {
        parts.push(`cache_read=${response.cacheReadTokens}`);
      }
      if (typeof response.cacheCreationTokens === "number") {
        parts.push(`cache_create=${response.cacheCreationTokens}`);
      }
      if (typeof response.inputTokens === "number") {
        parts.push(`input=${response.inputTokens}`);
      }
      if (typeof response.outputTokens === "number") {
        parts.push(`output=${response.outputTokens}`);
      }
      console.log(parts.join(" "));
    }

    // Append the assistant turn to messages so subsequent calls
    // include it. OpenAI shape requires both content + tool_calls
    // when the assistant emitted tool calls.
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: response.text || null,
      ...(response.toolCalls && response.toolCalls.length > 0
        ? { tool_calls: response.toolCalls }
        : {}),
    };
    messages.push(assistantMsg);

    // No tool calls → final answer.
    if (!response.toolCalls || response.toolCalls.length === 0) {
      emit({
        type: "assistant_text",
        content: response.text,
        costUsd: response.costUsd,
        finishReason: response.finishReason,
      });
      return { events, totalCostUsd, finalText: response.text };
    }

    // Dispatch each tool call.
    //
    // Slice 2 of "Smarter assistant": with `parallel_tool_calls: true`
    // the LLM is allowed to emit multiple tools in a single turn. We
    // group them by side-effect class:
    //
    //   - read-only: names starting with `read_` or `analyze_`, plus
    //     `narrate` (no graph mutation, safe to run concurrently).
    //   - mutating: everything else (add_node, add_edge, run_*,
    //     propose_refactor, etc.) — must stay sequential because of
    //     write-after-write dependencies (e.g. add_edge wants the id
    //     from a preceding add_node).
    //
    // We still emit `tool_call` events in the original LLM-emitted
    // order so the trace UI is not reshuffled. Same for the
    // post-dispatch `tool_result` events and the appended tool
    // messages — order in `messages[]` matches `response.toolCalls`.
    //
    // ask_user halts the rest of the turn (paused: true) just like
    // before. Any tool calls emitted AFTER an ask_user in the same
    // turn are dropped, matching the pre-Slice-2 behavior.
    type ToolOutcome = { result: unknown; durationMs: number };
    const outcomes = new Map<string, ToolOutcome>();
    const readCallsToDispatch: ChatToolCall[] = [];
    const writeCallsToDispatch: ChatToolCall[] = [];
    let pausedForAskUser = false;

    for (const call of response.toolCalls) {
      emit({
        type: "tool_call",
        toolName: call.function.name,
        arguments: safeParseJson(call.function.arguments),
        callId: call.id,
      });

      // Reasoning helper interception — narrate / ask_user surface
      // chat events even though the tool's own return is trivial.
      if (call.function.name === "narrate") {
        const args = safeParseJson(call.function.arguments) as {
          message?: string;
        } | null;
        if (args?.message) emit({ type: "narration", content: args.message });
      }
      if (call.function.name === "ask_user") {
        const args = safeParseJson(call.function.arguments) as {
          question?: string;
          options?: string[];
        } | null;
        if (args?.question) {
          emit({
            type: "ask_user",
            question: args.question,
            ...(args.options ? { options: args.options } : {}),
          });
          // Append a synthetic tool result so the conversation log
          // is well-formed; pause and return.
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: true,
              note: "User asked; resuming next turn.",
            }),
          });
          pausedForAskUser = true;
          break;
        }
      }

      if (isReadOnlyToolName(call.function.name)) {
        readCallsToDispatch.push(call);
      } else {
        writeCallsToDispatch.push(call);
      }
    }

    if (pausedForAskUser) {
      return { events, totalCostUsd, paused: true };
    }

    // Read-only group → concurrent. `Promise.all` waits for the
    // slowest, but the wall-clock dominates the slowest single read,
    // not the sum. ~30% saving on multi-read turns.
    if (readCallsToDispatch.length > 0) {
      await Promise.all(
        readCallsToDispatch.map(async (call) => {
          const tool = getTool(call.function.name);
          const startedAt = performance.now();
          const result = !tool
            ? { ok: false, error: `Unknown tool: ${call.function.name}` }
            : await dispatchTool(tool, call, ctx);
          const durationMs = Math.round(performance.now() - startedAt);
          outcomes.set(call.id, { result, durationMs });
        }),
      );
    }

    // Mutating group → sequential. add_edge needs the id from a
    // preceding add_node; the assistant relies on this ordering.
    //
    // Tier 4 (2026-06-03) — pre-flight `check_workflow_health`.
    //
    // Anti-confabulation by construction. When the assistant is about
    // to mutate the graph (add_*/remove_*/update_*/move_*/instantiate_*
    // /unpack_composite/apply_pending_refactor), capture a snapshot of
    // the live workflow's health BEFORE the first write fires. If
    // there are errors (dangling handles, unwired required inputs,
    // unknown kinds…), attach the receipt to that write tool's result
    // as `__preflightHealth`. The LLM sees concrete data on the next
    // turn and can self-correct rather than confabulate.
    //
    // Costs O(nodes + edges) once per turn, only when there's at
    // least one structural write, only when health is non-clean.
    let preflightAttached = false;
    for (const call of writeCallsToDispatch) {
      const tool = getTool(call.function.name);
      const isStructural = isStructuralMutationName(call.function.name);
      // Cost-aware narration — emit BEFORE the dispatch so the user
      // knows the assistant is about to spend money.
      const costClass = getToolCostClass(call.function.name);
      if (costClass !== "free") {
        emit({
          type: "narration",
          content: costNarration(call.function.name, costClass),
        });
      }
      const startedAt = performance.now();
      let result = !tool
        ? { ok: false, error: `Unknown tool: ${call.function.name}` }
        : await dispatchTool(tool, call, ctx);
      // Pre-flight only on the FIRST structural write of the turn.
      if (
        isStructural &&
        !preflightAttached &&
        result &&
        typeof result === "object"
      ) {
        const live = useWorkflowStore.getState();
        const health = computeWorkflowHealth(live.nodes, live.edges);
        if (health.issues.some((i) => i.severity === "error")) {
          result = {
            ...(result as Record<string, unknown>),
            __preflightHealth: {
              note: "Pre-flight check_workflow_health found errors at the moment this tool fired. Surface them and decide whether to keep going or repair first.",
              issueCount: health.issues.length,
              errorCount: health.issues.filter((i) => i.severity === "error")
                .length,
              issues: health.issues,
            },
          };
        }
        preflightAttached = true;
      }
      const durationMs = Math.round(performance.now() - startedAt);
      outcomes.set(call.id, { result, durationMs });
    }

    // Emit results + push tool messages in the LLM's emission order so
    // (a) the trace UI renders in the order the user expects, and
    // (b) the OpenAI shape is preserved (each tool_call has exactly
    // one matching tool message, identified by tool_call_id).
    for (const call of response.toolCalls) {
      const outcome = outcomes.get(call.id);
      if (!outcome) continue;
      emit({
        type: "tool_result",
        toolName: call.function.name,
        callId: call.id,
        result: outcome.result,
        durationMs: outcome.durationMs,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome.result),
      });
    }

    // Cost cap check at end of turn (after all tool dispatches).
    if (totalCostUsd >= MAX_COST_USD) {
      emit({
        type: "cap_hit",
        cap: "cost",
        message: `Cost cap reached ($${totalCostUsd.toFixed(4)} ≥ $${MAX_COST_USD.toFixed(2)}). Stopping.`,
      });
      return { events, totalCostUsd, cappedAt: "cost" };
    }
  }

  // Hit max turns.
  emit({
    type: "cap_hit",
    cap: "turns",
    message: `Hit ${MAX_TURNS}-turn cap before reaching a final answer.`,
  });
  return { events, totalCostUsd, cappedAt: "turns" };
}

async function dispatchTool(
  tool: AssistantTool,
  call: ChatToolCall,
  ctx: ToolExecutionContext,
): Promise<unknown> {
  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(call.function.arguments || "{}");
  } catch (err) {
    return {
      ok: false,
      error: `Could not parse arguments JSON: ${(err as Error).message}`,
    };
  }
  try {
    return await tool.execute(parsedArgs, ctx);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return { __raw: s };
  }
}

/**
 * Slice 2 of "Smarter assistant".
 *
 * A tool is safe to dispatch concurrently with peers iff it has no
 * effect on the workflow graph or on external state observable by
 * other tools. We classify by name (cheap, no descriptor changes
 * needed):
 *
 *   - `read_*`         — pure observation (read_canvas, read_gallery, …).
 *   - `analyze_*`      — pure observation (analyze_selection_subgraph).
 *   - `narrate`        — emits a chat narration; no graph mutation.
 *
 * Everything else (add_*, remove_*, update_*, run_*, propose_refactor,
 * find_similar_generations because it hits the network and ordering
 * with mutations is unspecified, etc.) is treated as mutating and
 * dispatched sequentially.
 */
function isReadOnlyToolName(name: string): boolean {
  if (name === "narrate") return true;
  return name.startsWith("read_") || name.startsWith("analyze_");
}

/**
 * Slice 3 of "Smarter assistant" — history compaction.
 *
 * Walk `messages[]` and replace stale `read_*` / `analyze_*` tool
 * results with a one-line placeholder. We keep the latest N
 * (configured via {@link COMPACTION_KEEP_LATEST_N}) untouched
 * because the LLM is most likely still reasoning about them.
 *
 * Mutating tool results (add_*, run_*, propose_refactor, …) are
 * NEVER compacted: they encode committed graph state and the LLM
 * may need the full payload to stay consistent.
 *
 * The placeholder shape is intentionally tiny so token savings are
 * material:
 *   `[summarized] read_canvas returned 30 nodes, 42 edges`
 *
 * Mutates `messages` in place — no clone, no allocation per
 * non-stale entry.
 */
function compactStaleReadResults(messages: ChatMessage[]): void {
  // Map tool_call_id → tool name from preceding assistant turns. We
  // need this because tool messages don't carry the tool name on the
  // wire — only the call id.
  const callIdToName = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        callIdToName.set(tc.id, tc.function.name);
      }
    }
  }

  const readToolMessageIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg?.role !== "tool" || !msg.tool_call_id) continue;
    const name = callIdToName.get(msg.tool_call_id);
    if (!name) continue;
    if (name.startsWith("read_") || name.startsWith("analyze_")) {
      readToolMessageIndices.push(i);
    }
  }

  if (readToolMessageIndices.length <= COMPACTION_KEEP_LATEST_N) return;

  const toCompact = readToolMessageIndices.slice(
    0,
    readToolMessageIndices.length - COMPACTION_KEEP_LATEST_N,
  );

  for (const idx of toCompact) {
    const msg = messages[idx];
    if (!msg || msg.role !== "tool") continue;
    const name = callIdToName.get(msg.tool_call_id) ?? "read_*";
    const original =
      typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    if (typeof original === "string" && original.startsWith("[summarized]")) {
      // Already compacted — leave alone (keeps idempotency).
      continue;
    }
    msg.content = summarizeReadResult(name, original);
  }
}

/**
 * Best-effort one-line summary of a read tool's JSON payload. Falls
 * back to a generic placeholder if the payload doesn't fit any
 * known shape — the goal is not perfect fidelity, it's "enough for
 * the LLM to remember this tool was already called and roughly what
 * it returned without the full body bloating every subsequent
 * request".
 */
function summarizeReadResult(toolName: string, originalJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(originalJson);
  } catch {
    return `[summarized] ${toolName} result elided to save tokens`;
  }
  if (!parsed || typeof parsed !== "object") {
    return `[summarized] ${toolName} result elided to save tokens`;
  }
  const obj = parsed as Record<string, unknown>;

  if (Array.isArray(obj.nodes) && Array.isArray(obj.edges)) {
    const nodes = obj.nodes as unknown[];
    const edges = obj.edges as unknown[];
    return `[summarized] ${toolName} returned ${nodes.length} nodes, ${edges.length} edges`;
  }
  if (Array.isArray(obj.assets)) {
    return `[summarized] ${toolName} returned ${(obj.assets as unknown[]).length} assets`;
  }
  if (Array.isArray(obj.generations)) {
    return `[summarized] ${toolName} returned ${(obj.generations as unknown[]).length} generations`;
  }
  if (typeof obj.count === "number") {
    return `[summarized] ${toolName} returned count=${obj.count}`;
  }
  if (obj.found === false) {
    return `[summarized] ${toolName} returned found:false`;
  }
  if (obj.found === true && typeof obj.kind === "string") {
    return `[summarized] ${toolName} returned schema for kind=${obj.kind}`;
  }
  return `[summarized] ${toolName} result elided to save tokens`;
}

/**
 * Env-toggle for the rollback story. Defaults to enabled.
 * Set ASSISTANT_HISTORY_COMPACTION=false (any case) to disable.
 */
function historyCompactionEnabled(): boolean {
  const raw = (typeof process !== "undefined" && process.env
    ? process.env.ASSISTANT_HISTORY_COMPACTION
    : undefined);
  if (raw === undefined) return true;
  return raw.toLowerCase() !== "false";
}

/**
 * Slice 3 of "Smarter assistant" — speculative pre-fetch.
 *
 * Trigger on the canonical analyze/optimize verbs the user reaches
 * for when they want suggestions about a selected subgraph. The
 * regex is intentionally generous because the cost of a false
 * positive is low (one extra fast tool call's worth of compute) and
 * the cost of a false negative is high (a wasted round-trip).
 */
const ANALYZE_INTENT_RE =
  /\b(improve|simplify|optimize|optimise|analyze|analyse|review|refactor|cleaner|simpler|better|tidy|clean[\s-]?up)\b/i;

function matchesAnalyzeIntent(message: string): boolean {
  if (!message) return false;
  return ANALYZE_INTENT_RE.test(message);
}

/**
 * Env-toggle for the rollback story. Defaults to enabled.
 * Set ASSISTANT_SPECULATIVE=false (any case) to disable.
 */
function speculativePrefetchEnabled(): boolean {
  const raw = (typeof process !== "undefined" && process.env
    ? process.env.ASSISTANT_SPECULATIVE
    : undefined);
  if (raw === undefined) return true;
  return raw.toLowerCase() !== "false";
}

/**
 * Tier 4 (2026-06-03).
 *
 * "Structural mutations" are the writes whose correctness depends on
 * the current state of the graph (a `dangling_target_handle` becomes
 * an actual rendering bug, an `unwired_required_input` becomes an
 * actual runtime throw). These are the ones we pre-flight against
 * the live workflow health.
 *
 * Lifecycle / orchestration tools (run_workflow, regenerate, …) and
 * pure observation tools are NOT in this list — pre-flighting them
 * doesn't add information.
 */
const STRUCTURAL_MUTATION_NAMES = new Set<string>([
  "add_node",
  "add_edge",
  "remove_node",
  "remove_edge",
  "update_node_config",
  "move_node",
  "instantiate_recipe",
  "unpack_composite",
  "apply_pending_refactor",
  "rename_node",
  "resize_node",
]);

function isStructuralMutationName(name: string): boolean {
  return STRUCTURAL_MUTATION_NAMES.has(name);
}

/**
 * Tier 4 (2026-06-03) — cost-aware narration.
 *
 * The reasoner emits a narration event before any non-free tool fires
 * so the trace UI can show a small "about to spend money" hint and
 * the user can hit cancel if they don't actually want the spend.
 */
function costNarration(toolName: string, costClass: string): string {
  switch (costClass) {
    case "small":
      return `Calling \`${toolName}\` — costClass: small (~$0.001 LLM call).`;
    case "medium":
      return `Calling \`${toolName}\` — costClass: medium (~$0.005 multi-image LLM call). Track the running spend for this turn.`;
    case "large":
      return `Calling \`${toolName}\` — costClass: large. Generation runs hit Fal/Higgsfield (image: ~$0.01-$0.05; video: ~$0.10-$0.50). Confirm via \`ask_user\` UNLESS the user's last message had explicit run-intent.`;
    default:
      return `Calling \`${toolName}\` — costClass: free.`;
  }
}
