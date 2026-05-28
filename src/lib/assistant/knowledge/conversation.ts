import type { ChatMessage } from "@/lib/llm/types";
import { useAssistantStore } from "@/lib/stores/assistant-store";

/**
 * Knowledge dimension: conversation history — Slice 7.2 (ADR-0041).
 *
 * Slice 6.8 persists chat messages cloud-side. Slice 7.1 added the
 * Chat Completions `messages[]` shape. This module is the bridge:
 * it reads the in-memory `useAssistantStore.messages` (already
 * hydrated from cloud on bootstrap) and converts each message into
 * the OpenAI Chat Completions format so the LLM sees actual
 * multi-turn context — not just the latest user prompt.
 *
 * Cap: last 20 messages. After that, the assistant can call
 * `read_recent_chat({ before, limit })` (Slice 7.3 read tool) for
 * deeper history. Older context will eventually be summarized via
 * RAG (Slice 7.6).
 *
 * Notes:
 *   - We DO NOT include the conversation in the SYSTEM prompt — it
 *     goes in the `messages[]` array, where the LLM expects multi-
 *     turn context.
 *   - Plan cards from previous assistant messages are flattened to
 *     plain JSON-in-text for now (we'd lose typed `tool_calls`
 *     across turns otherwise). Slice 7.3 will preserve `tool_calls`
 *     verbatim once the reasoner runs the proper loop.
 */

const HISTORY_CAP = 20;

export function buildConversationMessages(): ChatMessage[] {
  const messages = useAssistantStore.getState().messages;
  // Keep only the last N (oldest first inside the slice).
  const tail = messages.slice(-HISTORY_CAP);
  const out: ChatMessage[] = [];
  for (const m of tail) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      // Compose content from raw content + plan summary if present.
      let content = m.content;
      if (m.plan && m.plan.steps) {
        content =
          (content ? content + "\n\n" : "") +
          `[plan emitted: ${JSON.stringify({
            reasoning: m.plan.reasoning,
            steps: m.plan.steps.map((s) => s.kind),
            estimatedCostUsd: m.plan.estimatedCostUsd,
          })}]`;
      }
      if (m.error) {
        content =
          (content ? content + "\n\n" : "") + `[error: ${m.error}]`;
      }
      out.push({ role: "assistant", content: content || null });
      continue;
    }
    // Skip "system" messages — system content is built fresh per call
    // from the knowledge bundle.
  }
  return out;
}
