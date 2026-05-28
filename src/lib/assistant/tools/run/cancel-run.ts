import { z } from "zod";

import { useExecutionStore } from "@/lib/stores/execution-store";

import type { AssistantTool } from "../index";

const argsSchema = z.object({}).strict();

export const cancelRunTool: AssistantTool = {
  name: "cancel_run",
  description:
    "Abort the in-flight workflow run, if any. Idempotent — no-op when nothing is running.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    argsSchema.parse(rawArgs ?? {});
    const wasRunning = useExecutionStore.getState().isRunning;
    useExecutionStore.getState().cancelRun();
    return { ok: true, wasRunning };
  },
};
