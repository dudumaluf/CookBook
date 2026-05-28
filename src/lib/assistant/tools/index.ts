import type { ToolDefinition } from "@/lib/llm/types";

/**
 * Tool registry — Slice 7.1 (ADR-0041) shell.
 *
 * The single source of truth for "what tools can the assistant call".
 * Each tool is one file under `tools/<category>/<name>.ts` exporting:
 *
 *   - `name`: identifier the LLM uses in tool_use blocks.
 *   - `description`: short prose for the system prompt.
 *   - `parameters`: JSON Schema for arguments.
 *   - `execute(args, ctx)`: runs the tool, returns the JSON-stringified
 *     result that goes back to the LLM as tool_result.
 *
 * Slice 7.1 ships the SHAPE — the registry is empty. Slices 7.2+
 * fill it in:
 *
 *   - 7.2: read tools (read_canvas, read_node_state, read_library,
 *     read_gallery, read_recipe).
 *   - 7.3: construct tools (add_node, add_edge, …) + recipe tools +
 *     run tools + reasoning helpers (ask_user, narrate).
 *   - 7.4: eval tools (evaluate_result, compare_results, regenerate).
 *   - 7.5: capability-gap tools (propose_node_schema).
 *   - 7.6: RAG tools (find_similar_generations).
 *
 * The system prompt is auto-generated from `getToolDefinitions()`, so
 * every new tool's schema lands in the prompt with zero drift.
 */

/**
 * One registered tool. The execute fn is intentionally untyped wrt
 * args / return — each tool's own module gives a stronger type via Zod
 * parsing inside execute. We keep the registry generic so heterogeneous
 * tools live alongside each other.
 */
export interface AssistantTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute: (
    args: unknown,
    ctx: ToolExecutionContext,
  ) => Promise<unknown>;
}

/**
 * Context every tool receives. Slice 7.1 ships the empty shape; 7.3+
 * adds the real fields (ownerId, projectId, signal, narrate fn, etc.)
 * once the reasoner runtime exists.
 */
export interface ToolExecutionContext {
  ownerId?: string;
  projectId?: string;
  signal?: AbortSignal;
}

const tools: AssistantTool[] = [
  // Empty until 7.2. Each future slice imports its tools from
  // `tools/<category>/...` and pushes them here (or registers via a
  // `registerTool(...)` helper if we grow > 30 tools).
];

/**
 * The full list of tool definitions in OpenAI Chat Completions format.
 * Used by both:
 *   - the system-prompt builder (so the LLM knows the tool surface),
 *   - the LLM call's `tools[]` parameter (for native tool calling).
 */
export function getToolDefinitions(): ToolDefinition[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Look up a tool by name to dispatch a `tool_use` block.
 * Slice 7.1: always undefined (registry empty). 7.3 fills in.
 */
export function getTool(name: string): AssistantTool | undefined {
  return tools.find((t) => t.name === name);
}

/**
 * Test / programmatic helper — used by tests to assert the registry
 * has the expected shape. Production code calls `getTool(name)` /
 * `getToolDefinitions()` instead of poking the array directly.
 */
export function _internalToolList(): readonly AssistantTool[] {
  return tools;
}
