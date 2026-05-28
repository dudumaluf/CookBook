import { z } from "zod";

import type { AssistantTool } from "../index";

/**
 * ask_user — Slice 7.3 (ADR-0042).
 *
 * Pause the loop and ask the user a clarifying question. The
 * reasoner intercepts this tool call: instead of executing
 * immediately, it surfaces the question in the ChatSheet and
 * waits for the user's reply (which becomes the next turn's
 * user message). When that arrives, the loop resumes with the
 * answer threaded back into context.
 *
 * Use when:
 *   - Multiple Soul IDs / images / recipes match the user's intent.
 *   - The plan would spend > $0.05 and you want explicit approval
 *     beyond the cost cap.
 *   - The user's request is ambiguous enough that guessing risks
 *     wasted spend.
 *
 * The actual pause-and-resume mechanic lives in `reasoner.ts`.
 * This tool's execute() is a no-op that signals the reasoner via
 * a sentinel return value.
 */

const argsSchema = z
  .object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const askUserTool: AssistantTool = {
  name: "ask_user",
  description:
    "Pause the loop and ask the user a clarifying question. Optional `options` array surfaces buttons in the chat. Resume happens with the user's answer as the next turn.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "Question text shown to the user.",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Optional preset answers; user can also type free-form.",
      },
    },
    required: ["question"],
    additionalProperties: false,
  },
  execute: async (rawArgs) => {
    argsSchema.parse(rawArgs);
    // Sentinel return — reasoner pauses on `__pause: true`.
    return { __pause: true, ok: true };
  },
};
