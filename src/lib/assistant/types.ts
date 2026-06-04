import { z } from "zod";

/**
 * Assistant DSL — Slice 6.4b (ADR-0037).
 *
 * The assistant takes a free-form user message and emits a structured
 * `AssistantPlan` describing the steps to accomplish the request. The
 * client parses the plan, shows a preview to the user, and on confirm
 * executes each step against the existing store APIs (workflow, asset,
 * project) before triggering the engine.
 *
 * No native tool-calls — the LLM responds with a JSON object matching
 * `assistantPlanSchema` (validated via Zod). Pragmatic for M0a; native
 * tool calling can land later via a streaming endpoint extension.
 *
 * Step kinds intentionally minimal to ship M0a Acceptance:
 *   - `clear-canvas`: wipe nodes/edges (start fresh).
 *   - `instantiate-recipe`: load a saved recipe onto canvas at a position.
 *   - `set-node-config`: patch a node's config (e.g. set Text prompt,
 *     set HiggsfieldImageGen.batchSize).
 *   - `link-soul-id`: pick a Soul ID asset from the library and assign it
 *     to a Soul ID node by id.
 *   - `run`: trigger startRun.
 *
 * `cost` is the assistant's best estimate so the confirmation UI can
 * surface "Estimated cost: $0.08, OK to run?". If the user has the
 * `approvalGateOn` flag, the execution UI gates on user click.
 */

export const assistantStepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("clear-canvas"),
  }),
  z.object({
    kind: z.literal("instantiate-recipe"),
    // Relaxed to plain string — Postgres uuid validation kicks in at the
    // repository layer anyway. UUID-only schema breaks LLMs that occasionally
    // emit slightly mangled formats; we'd rather surface "recipe not found"
    // than reject the whole plan.
    recipeId: z.string().min(1),
    position: z
      .object({ x: z.number(), y: z.number() })
      .default({ x: 100, y: 100 }),
  }),
  z.object({
    kind: z.literal("set-node-config"),
    nodeId: z.string(),
    config: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("link-soul-id"),
    nodeId: z.string(),
    assetId: z.string(),
  }),
  z.object({
    kind: z.literal("run"),
  }),
]);

export type AssistantStep = z.infer<typeof assistantStepSchema>;

export const assistantPlanSchema = z.object({
  /** A short human explanation of what's being done + why. */
  reasoning: z.string(),
  /** Ordered list of steps the executor should run. */
  steps: z.array(assistantStepSchema),
  /**
   * Estimated total cost in USD. Best-effort; LLM should sum the cost
   * of every gen / LLM call the plan triggers using the rough rate
   * card in the system prompt.
   */
  estimatedCostUsd: z.number().nonnegative().default(0),
  /** Optional confirmation copy — the assistant's "are you sure?" line. */
  confirmation: z.string().optional(),
});

export type AssistantPlan = z.infer<typeof assistantPlanSchema>;

/**
 * Persisted tool receipt — ADR-0069 F10.
 *
 * One per dispatched tool call within an assistant turn. The full
 * `result` blob is stored verbatim so the chat-sheet can re-render
 * the same `ToolCallReceiptLine` for past messages that it shows for
 * the current run's `liveEvents`.
 *
 * Receipts persist on the *assistant* message they were emitted on, so
 * the user can scroll back through prior submits and audit exactly
 * which tools fired with which receipts — closing the "what did the
 * assistant actually do?" forensic gap that motivated the ADR.
 */
export interface PersistedToolReceipt {
  /** Tool name as registered in `getToolDefinitions()`. */
  tool: string;
  /** OpenAI tool_call_id; matches the LLM's emission. */
  callId: string;
  /** Wall-clock dispatch duration. Useful for "why is this slow?". */
  durationMs: number;
  /** Full tool result payload (ok/error + structured receipt fields). */
  result: unknown;
}

/**
 * Persisted ask_user question — ADR-0069 F11.
 *
 * When the assistant calls `ask_user`, the reasoner pauses and emits
 * an `ask_user` event. The matching assistant message stores the
 * question + options here so:
 *   1. Reload the chat history → user still sees what was asked.
 *   2. Next turn's conversation history shows the LLM the original
 *      question alongside the user's reply (which is the next user
 *      message after this one chronologically).
 *   3. UI can render the question with the same QuestionCard layout
 *      whether it's live (pendingQuestion) or persisted (this field).
 *
 * Pre-F11 the assistant message was persisted as "(no response)" with
 * no record of the question, so cross-session continuity broke.
 */
export interface PersistedQuestion {
  question: string;
  options?: string[];
}

export interface AssistantMessage {
  role: "user" | "assistant" | "system";
  content: string;
  /**
   * Parsed plan when role === "assistant" and the response was valid JSON.
   * UI uses this to render a confirmation card.
   */
  plan?: AssistantPlan;
  /** Set when an assistant response failed to parse. */
  error?: string;
  /** Server-reported cost of producing this response. */
  costUsd?: number;
  /**
   * Tool receipts captured during this assistant turn (ADR-0069 F10).
   * Empty array when the assistant produced text without tool calls.
   * Undefined for user messages and pre-F10 rows hydrated from the cloud.
   */
  toolReceipts?: PersistedToolReceipt[];
  /**
   * Set when this assistant turn ended in `ask_user` (ADR-0069 F11).
   * The next user message in chronological order is the answer. Carries
   * the original question + options so cross-session continuity holds
   * and the UI can render the same QuestionCard for live vs persisted.
   */
  question?: PersistedQuestion;
  timestamp: number;
}
