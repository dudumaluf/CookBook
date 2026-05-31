"use client";

import { callOpenRouter } from "@/lib/llm/call-openrouter";
import type {
  ChatMessage,
  ChatToolCall,
  LlmSuccessResponse,
} from "@/lib/llm/types";

import { buildKnowledgeBundle } from "./knowledge";
import {
  buildReferencesNote,
  type PromptReference,
} from "./prompt-references";
import { getTool, getToolDefinitions } from "./tools";
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
const MAX_COST_USD = 0.5;
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

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
    model = DEFAULT_MODEL,
    onEvent,
  } = options;

  const events: ReasonerEvent[] = [];
  function emit(ev: ReasonerEvent) {
    events.push(ev);
    onEvent?.(ev);
  }

  const ctx: ToolExecutionContext = { ownerId, projectId, signal };

  emit({ type: "user", content: userMessage });

  // Initial system prompt + history.
  const bundle = await buildKnowledgeBundle({ ownerId, projectId });
  const systemContent = bundle.system + "\n\n" + REASONER_INSTRUCTIONS;
  // Append the referenced-items note to the user turn (the chat UI still
  // shows the clean userMessage via the `user` event above).
  const refsNote = references ? buildReferencesNote(references) : "";
  const userContent = refsNote ? `${userMessage}\n\n${refsNote}` : userMessage;
  const messages: ChatMessage[] = [
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

    let response: LlmSuccessResponse;
    try {
      response = await callOpenRouter({
        model,
        messages,
        system: systemContent,
        tools: toolDefs,
        toolChoice: "auto",
        temperature: 0.2,
        maxTokens: 1500,
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

    // Dispatch each tool call. Sequential — `parallel_tool_calls`
    // is off so the LLM emitted them ordered.
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
          return { events, totalCostUsd, paused: true };
        }
      }

      const tool = getTool(call.function.name);
      const startedAt = performance.now();
      let result: unknown;
      if (!tool) {
        result = {
          ok: false,
          error: `Unknown tool: ${call.function.name}`,
        };
      } else {
        result = await dispatchTool(tool, call, ctx);
      }
      const durationMs = Math.round(performance.now() - startedAt);
      emit({
        type: "tool_result",
        toolName: call.function.name,
        callId: call.id,
        result,
        durationMs,
      });

      // Append the tool result to messages so the next LLM call
      // sees it. Each tool call gets exactly one matching tool
      // message, identified by tool_call_id.
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
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

const REASONER_INSTRUCTIONS = `## OPERATING INSTRUCTIONS

You are operating in a tool-calling loop. Each turn:
- Read the latest context (system + conversation + last tool results).
- Decide: is the user's request handled? If yes, write the final assistant message (no tool calls). If not, call one or more tools to make progress.

Rules:
- Always call \`narrate\` to keep the user informed during long tool sequences (e.g. "checking your gallery for noir prompts...", "found 3 candidates").
- Call \`ask_user\` when ambiguous: which Soul ID? which image? confirm cost > $0.05?
- Use \`read_*\` tools to GROUND your decisions in real state, not assumptions.
- Construct workflows step-by-step: \`add_node\` for each, then \`add_edge\` for each connection.
- ALWAYS finish with \`run_workflow\` (or \`run_from\`) when the user wanted output, not just a graph.
- When done, write a short final assistant message summarizing what you did + pointing the user at the result (Gallery / canvas).
- DO NOT include markdown JSON or code-fences in the final assistant message — write natural prose.

Cost discipline:
- Reactive nodes (Text, Image, Number, Iterators) cost nothing — use them freely.
- Non-reactive (LLM, Higgsfield, Export) cost real money. Confirm via \`ask_user\` when single-message spend > $0.05.
- Hard caps: 20 tool calls + $0.50 per user message. If you approach either, narrate + finish.

## ANALYSIS / OPTIMIZATION FLOW

When the SELECTION block is present in your context (\`## SELECTION\` after \`## CANVAS\`) the user has highlighted a subgraph and likely wants to discuss IT specifically — not the whole canvas. When their message reads as "analyze", "review", "what does this do", "how can I improve / simplify / optimize this", "is this organized well", "can you make it better", or similar, follow this order strictly:

1. **UNDERSTAND.** State explicitly what the workflow is doing in plain prose. Cover:
   - Inputs the slice accepts (the \`Exposed I/O if saved as recipe\` block tells you).
   - Outputs it produces.
   - The high-level intent you've inferred (e.g. "this is a system-prompt builder that fans out 5 variants from one user idea").
   - Any patterns / scaffolding you noticed (chains of \`text\` nodes feeding an \`llm-text\`, repeated structure suggesting a missing iterator, etc.).
2. **CRITIQUE.** Call out specific friction. Be concrete about the node ids:
   - Redundant nodes (e.g. "n3 + n4 are both Text feeding the same LLM \`user\` socket — a Text Concat would replace them").
   - Outputs that no one reads.
   - Configs that would be valuable as recipe params (\`exposedParams\`) so the recipe is tweakable without unpacking.
   - Wiring that bypasses the @variable feature (Text node) where it would be simpler.
3. **PROPOSE.** Offer 1–3 specific changes the user can opt into, each as a single sentence + a hint of which tools you'd call. Example:
   > "1. Collapse n3 and n4 into one Text Concat — I'd \`add_node\` a \`text-concat\`, \`add_edge\` from each chunk to its inputs, then \`remove_node\` the two originals."
4. **WAIT.** **Do NOT mutate the graph in this turn.** Write your final assistant message after step 3 and stop. The user must say "apply", "do it", "yes do option 2", or accept a specific suggestion before you call any mutating tools.
5. **APPLY (next turn, only on confirmation).** When the user confirms, call \`propose_refactor\` (NOT raw \`add_node\` / \`remove_node\`) so the change goes through the preview-diff modal. The user's atomic confirm there is the final gate. Pass a one-line \`summary\` and an ordered \`operations[]\` list. The tool just QUEUES the proposal — your job is done after the call; write the final assistant message and stop.`;
