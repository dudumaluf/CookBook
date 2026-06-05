import type { ChatMessage } from "@/lib/llm/types";
import { useAssistantStore } from "@/lib/stores/assistant-store";

/**
 * Knowledge dimension: conversation history — Slice 7.2 (ADR-0041),
 * extended by ADR-0069 F10 + F11 (persisted tool receipts + ask_user
 * questions), and ADR-0071 (anti-LARP format).
 *
 * Slice 6.8 persists chat messages cloud-side. Slice 7.1 added the
 * Chat Completions `messages[]` shape. This module is the bridge:
 * it reads the in-memory `useAssistantStore.messages` (already
 * hydrated from cloud on bootstrap) and converts each message into
 * the OpenAI Chat Completions format so the LLM sees actual
 * multi-turn context — not just the latest user prompt.
 *
 * Cap: last 20 messages. After that, the assistant can call
 * `read_recent_chat({ before, limit, query })` (read tool — see
 * `src/lib/assistant/tools/read/read-recent-chat.ts`) to page
 * deeper into the session log. Cross-session memory still goes
 * through the RAG path (find_similar_generations,
 * read_user_preferences).
 *
 * ## ADR-0071 — anti-LARP format switch
 *
 * Pre-0071 the system injected past-turn metadata using square-bracket
 * markers: `[tools fired: …]`, `[plan emitted: …]`, `[asked: "…"]`,
 * `[error: …]`. The model SAW these in its context and learned the
 * pattern, then started ECHOING the same format in its own prose to
 * fake successful tool execution ("✓ patched X. [tools fired:
 * update_node_config: text_x {text}]") — a hallucination class that
 * the F22 contradiction banner caught but didn't stop, because the
 * user-facing message still rendered the lie verbatim.
 *
 * The fix is twofold and lives in this file + `chat-sheet.tsx`:
 *   1. Switch the system-emitted format to `<system-…>` XML tags
 *      (Anthropic-native, harder to confuse with prose).
 *   2. The contradiction detector treats ANY echo of
 *      `<system-tool-trace>`, `[tools fired:`, or related markers in
 *      the assistant's final text as a 100%-positive hallucination
 *      signal — those formats are system-only, by construction.
 *
 * Notes:
 *   - We DO NOT include the conversation in the SYSTEM prompt — it
 *     goes in the `messages[]` array, where the LLM expects multi-
 *     turn context.
 *   - Plan cards from previous assistant messages are flattened to
 *     a `<system-plan>` tag for now (we'd lose typed `tool_calls`
 *     across turns otherwise).
 *   - ADR-0069 F10 / F11 unchanged in spirit: the tool receipts and
 *     ask_user questions still get summarized for cross-submit
 *     memory. Only the wrapping format changed.
 */

const HISTORY_CAP = 20;
const RECEIPT_SUMMARY_LIMIT = 6;

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
      // Compose content from raw content + plan summary + tool receipts
      // + question summary so cross-submit history is honest about what
      // happened. Wrapping format is `<system-…>` XML tags (ADR-0071);
      // these are READ-ONLY context the LLM must NEVER echo (see
      // `instructions.ts` § ANTI-HALLUCINATION).
      let content = m.content;
      if (m.plan && m.plan.steps) {
        const planJson = JSON.stringify({
          reasoning: m.plan.reasoning,
          steps: m.plan.steps.map((s) => s.kind),
          estimatedCostUsd: m.plan.estimatedCostUsd,
        });
        content =
          (content ? content + "\n\n" : "") +
          `<system-plan>${planJson}</system-plan>`;
      }
      if (m.toolReceipts && m.toolReceipts.length > 0) {
        const receiptSummaries = m.toolReceipts
          .slice(0, RECEIPT_SUMMARY_LIMIT)
          .map((r) => summarizeReceipt(r))
          .filter((s): s is string => s !== null);
        const more =
          m.toolReceipts.length > RECEIPT_SUMMARY_LIMIT
            ? ` (+${m.toolReceipts.length - RECEIPT_SUMMARY_LIMIT} more)`
            : "";
        if (receiptSummaries.length > 0) {
          content =
            (content ? content + "\n\n" : "") +
            `<system-tool-trace>${receiptSummaries.join("; ")}${more}</system-tool-trace>`;
        }
      }
      if (m.question) {
        const opts =
          m.question.options && m.question.options.length > 0
            ? ` options=[${m.question.options.join(", ")}]`
            : "";
        content =
          (content ? content + "\n\n" : "") +
          `<system-ask>"${m.question.question}"${opts}</system-ask>`;
      }
      if (m.error) {
        content =
          (content ? content + "\n\n" : "") +
          `<system-error>${m.error}</system-error>`;
      }
      out.push({ role: "assistant", content: content || null });
      continue;
    }
    // Skip "system" messages — system content is built fresh per call
    // from the knowledge bundle.
  }
  return out;
}

/**
 * Compact human-readable summary of a persisted tool receipt for
 * inclusion in cross-submit conversation history. The full result blob
 * is preserved on the message itself (chat-sheet renders it); this
 * summary only feeds the LLM context window.
 */
function summarizeReceipt(r: {
  tool: string;
  result: unknown;
}): string | null {
  const result = r.result as
    | {
        ok?: boolean;
        error?: string;
        changed?: string[];
        nodeId?: string;
        nodeKind?: string;
        entity?: { id?: string; kind?: string };
        bulk?: Record<string, unknown>;
      }
    | null
    | undefined;
  if (!result || typeof result !== "object") {
    return `${r.tool}: ok`;
  }
  if (result.ok === false) {
    const reason = result.error
      ? truncate(result.error, 60)
      : "unknown error";
    return `${r.tool}: failed (${reason})`;
  }
  if (Array.isArray(result.changed) && result.changed.length > 0) {
    if (result.changed[0] === "__create" && result.entity?.id) {
      return `${r.tool}: created ${result.entity.id}${result.entity.kind ? ` (${result.entity.kind})` : ""}`;
    }
    if (result.changed[0] === "__delete" && result.entity?.id) {
      return `${r.tool}: deleted ${result.entity.id}`;
    }
    if (result.changed[0] === "__bulk" && result.bulk) {
      return `${r.tool}: bulk(${Object.entries(result.bulk).map(([k, v]) => `${k}=${v}`).join(",")})`;
    }
    if (result.nodeId) {
      return `${r.tool}: ${result.nodeId} {${result.changed.join(", ")}}`;
    }
    return `${r.tool}: ${result.changed.join(",")}`;
  }
  return `${r.tool}: ok`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 3) + "...";
}
