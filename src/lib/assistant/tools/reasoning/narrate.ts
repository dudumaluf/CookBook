import { z } from "zod";

import type { AssistantTool } from "../index";

/**
 * narrate — Slice 7.3 (ADR-0042).
 *
 * Emit a non-actionable progress message that surfaces in the
 * ChatSheet's streaming feed. Use to keep the user informed during
 * long tool sequences ("checking your gallery for noir prompts...",
 * "found 3 candidates, picking the most recent...").
 *
 * The reasoner intercepts this tool call specially — it doesn't
 * actually mutate any store; it just appends a system-flagged
 * message to the chat. Always returns `{ ok: true }` so the LLM
 * can chain it freely.
 */

const argsSchema = z
  .object({
    message: z.string().min(1),
  })
  .strict();

export const narrateTool: AssistantTool = {
  name: "narrate",
  description:
    "Surface a brief progress note in the chat (visible to the user). Use to keep them in the loop during long tool sequences. Does NOT mutate state and does NOT trigger runs — narrate is a chat-only side channel. If the user asked to run / regenerate / re-execute something, you MUST call run_workflow / run_from / regenerate; saying 'I'm running it' via narrate without firing the actual run tool is a contradiction the chat will surface to the user.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "1-2 sentences. Read by the user as a status note.",
      },
    },
    required: ["message"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    argsSchema.parse(rawArgs);
    // The reasoner intercepts this name to also emit a chat-side
    // narration message. The tool's own return is just an ack.
    return { ok: true };
  },
};
