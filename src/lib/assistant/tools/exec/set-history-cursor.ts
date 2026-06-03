import { z } from "zod";

import { useExecutionStore } from "@/lib/stores/execution-store";

import type { AssistantTool } from "../index";

/**
 * set_history_cursor — Tier 1.4 (2026-06-03).
 *
 * Pick a different history entry as the active output of a node.
 * Mirrors the IteratorCursor arrows the user has on the node body —
 * useful for "go back to generation 3, that one was best" via chat.
 *
 * The store clamps the index defensively (nothing fancy here:
 * `Math.min(Math.max(0, Math.trunc(idx)), history.length - 1)`) so
 * an LLM passing -1 or 99 lands on a valid entry. We pre-validate
 * presence so we can return a clear error instead of a silent
 * no-op.
 */

const argsSchema = z
  .object({
    nodeId: z.string().min(1),
    cursorIndex: z.number().int(),
  })
  .strict();

export const setHistoryCursorTool: AssistantTool = {
  name: "set_history_cursor",
  description:
    "Choose a node's active output from its history. Index 0 = oldest, history.length-1 = newest. Negative or out-of-range indices are clamped. No-op when the node has no history. Returns the resolved index actually applied.",
  parameters: {
    type: "object",
    properties: {
      nodeId: { type: "string" },
      cursorIndex: {
        type: "integer",
        description:
          "0-based history index. 0 = oldest entry, history.length-1 = newest. Out-of-range gets clamped.",
      },
    },
    required: ["nodeId", "cursorIndex"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const store = useExecutionStore.getState();
    const rec = store.records.get(args.nodeId);
    if (!rec) {
      return {
        ok: false,
        error: `Node ${args.nodeId} has no execution record yet — run it once before navigating its history.`,
      };
    }
    const len = rec.history?.length ?? 0;
    if (len === 0) {
      return {
        ok: false,
        error: `Node ${args.nodeId} has no history entries — only the latest output exists.`,
      };
    }
    store.setHistoryCursor(args.nodeId, args.cursorIndex);
    const after = useExecutionStore
      .getState()
      .records.get(args.nodeId);
    return {
      ok: true,
      resolvedIndex: after?.cursorIndex ?? 0,
      historyLength: len,
    };
  },
};
