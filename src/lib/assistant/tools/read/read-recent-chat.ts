import { z } from "zod";

import { useAssistantStore } from "@/lib/stores/assistant-store";

import type { AssistantTool } from "../index";

/**
 * read_recent_chat — Tier 1.1 (2026-06-03).
 *
 * The reasoner's per-call `messages[]` ships only the last
 * `HISTORY_CAP = 20` messages (see
 * `src/lib/assistant/knowledge/conversation.ts`). For deeper
 * context the assistant has to ASK for it via this tool — the
 * docblock there already promised it; this is the implementation.
 *
 * Three orthogonal arguments, all optional:
 *
 *   - `before` — Unix-ms timestamp cursor. Returns messages whose
 *     `timestamp < before` so the assistant can paginate
 *     backwards. Omit to fetch from the most recent.
 *   - `limit` — how many to return (default 10, capped at 50 to
 *     keep token budget reasonable).
 *   - `query` — case-insensitive substring filter on
 *     `message.content`. When set, ONLY matching messages count
 *     toward the limit (so a search for "coffee" inside 200
 *     turns of chat returns the matches, not the latest 10).
 *
 * Returns the matched slice in chronological order (oldest →
 * newest within the slice). Plan bodies are flattened to a small
 * marker (the assistant rarely needs the full plan JSON across
 * turns; if it does, it can re-inspect the live state). Errors
 * and costs are surfaced verbatim — they're cheap and disclose
 * useful context (a previous turn errored / cost a lot, so reuse
 * cautiously).
 */

const argsSchema = z
  .object({
    before: z.number().positive().optional(),
    limit: z.number().int().positive().max(50).optional(),
    query: z.string().min(1).optional(),
  })
  .strict();

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

interface ReadRecentChatRow {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  costUsd?: number;
  error?: string;
  /** Marker that a structured plan was attached to this assistant
   *  message. The body is intentionally stripped — if the assistant
   *  needs it, it can call other read tools to inspect live state. */
  hadPlan?: true;
}

interface ReadRecentChatResult {
  ok: true;
  totalChatLength: number;
  returned: number;
  oldestTimestamp: number | null;
  /** When the search filtered by `query`, this is the matched slice;
   *  otherwise it's the most recent `limit` messages. Always
   *  chronological (oldest → newest within the returned slice). */
  messages: ReadRecentChatRow[];
}

function flatten(
  msg: import("@/lib/assistant/types").AssistantMessage,
): ReadRecentChatRow {
  const row: ReadRecentChatRow = {
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  };
  if (msg.costUsd !== undefined) row.costUsd = msg.costUsd;
  if (msg.error !== undefined) row.error = msg.error;
  if (msg.plan !== undefined) row.hadPlan = true;
  return row;
}

export const readRecentChatTool: AssistantTool = {
  name: "read_recent_chat",
  description:
    "Read chat history beyond the 20-message cap that lands in messages[] each turn. Use to recall context the user mentioned earlier in the same session ('the moodboard from earlier', 'what model did we settle on'). Args: { before?: ms-timestamp cursor, limit?: 1..50 (default 10), query?: substring filter }. Returns messages in chronological order with error/cost markers preserved. Plan bodies are stripped — re-read live state if you need them.",
  parameters: {
    type: "object",
    properties: {
      before: {
        type: "number",
        description:
          "Unix-ms cursor. Only messages with timestamp < before are returned. Omit to fetch from most recent.",
      },
      limit: {
        type: "number",
        description: "Max messages to return (1-50, default 10).",
      },
      query: {
        type: "string",
        description:
          "Case-insensitive substring filter on message content. When set, ONLY matching messages count toward the limit.",
      },
    },
    additionalProperties: false,
  },
  execute: async (rawArgs): Promise<ReadRecentChatResult> => {
    const args = argsSchema.parse(rawArgs ?? {});
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const all = useAssistantStore.getState().messages;

    // Apply cursor first (cheap), then optional query filter.
    let pool = all;
    if (args.before !== undefined) {
      pool = pool.filter((m) => m.timestamp < args.before!);
    }
    if (args.query !== undefined) {
      const needle = args.query.toLowerCase();
      pool = pool.filter((m) =>
        m.content.toLowerCase().includes(needle),
      );
    }

    // Take the most-recent `limit` then re-sort chronologically so the
    // returned slice reads in time-forward order — easier for the LLM
    // to reason about than reverse-chrono.
    const tail = pool.slice(-limit);
    const sorted = [...tail].sort((a, b) => a.timestamp - b.timestamp);

    return {
      ok: true,
      totalChatLength: all.length,
      returned: sorted.length,
      oldestTimestamp: sorted[0]?.timestamp ?? null,
      messages: sorted.map(flatten),
    };
  },
};
