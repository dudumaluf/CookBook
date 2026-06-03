import { z } from "zod";

import { useExecutionStore } from "@/lib/stores/execution-store";

import type { AssistantTool } from "../index";

/**
 * clear_cache — Tier 1.4 (2026-06-03).
 *
 * Drop every cached output. The next run will cold-execute every
 * node. Use when the upstream provider gave you a bad response that
 * the cache memo'd, or when you genuinely want to charge the credit
 * card for a re-run (e.g. seeded image generators where the cached
 * result was a fluke). Per-node records are NOT cleared by this —
 * use `clear_run` for that.
 */

const argsSchema = z.object({}).strict();

export const clearCacheTool: AssistantTool = {
  name: "clear_cache",
  description:
    "Drop every cached node output. Next run cold-executes everything. Per-node EXECUTION RECORDS are preserved (use clear_run to reset those). Common reason: upstream returned a bad/empty response that got memo'd, and you want a fresh attempt.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    argsSchema.parse(rawArgs ?? {});
    useExecutionStore.getState().clearCache();
    return { ok: true };
  },
};
