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

export interface AssistantContext {
  /** Recipes available to use in `instantiate-recipe`. */
  recipes: { id: string; name: string; description: string | null }[];
  /** Soul ID assets available to link. */
  soulIds: { id: string; name: string; variant: string }[];
  /** Image assets available (URL refs). */
  images: { id: string; name: string; url: string }[];
  /** Current canvas state (counts only — full graph would blow context). */
  canvas: { nodeCount: number; edgeCount: number };
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
  timestamp: number;
}
