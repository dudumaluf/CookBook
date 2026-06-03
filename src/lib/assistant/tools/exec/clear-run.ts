import { z } from "zod";

import { useExecutionStore } from "@/lib/stores/execution-store";

import type { AssistantTool } from "../index";

/**
 * clear_run — Tier 1.4 (2026-06-03).
 *
 * Forget every per-node execution record (status, output, usage,
 * history). All nodes render as `idle` again on canvas. The
 * underlying SESSION CACHE is preserved — a re-run with the same
 * inputs is still instant. Use `clear_cache` if you also want
 * cold runs (e.g. provider returned a bad response that got
 * cached).
 *
 * Idempotent — running on an already-empty record map is a no-op.
 */

const argsSchema = z.object({}).strict();

export const clearRunTool: AssistantTool = {
  name: "clear_run",
  description:
    "Wipe all per-node execution records (status, output, usage, history). Nodes go back to idle. Cache is PRESERVED — re-running is still cheap. Use clear_cache if you also need cold reruns.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    argsSchema.parse(rawArgs ?? {});
    useExecutionStore.getState().clearRun();
    return { ok: true };
  },
};
