import { z } from "zod";

import { getCodePrompts, PROMPT_KEYS } from "@/lib/prompts/registry";
import { resolvePrompt } from "@/lib/prompts/resolve-prompt";

import type { AssistantTool } from "../index";

const argsSchema = z.object({
  promptKey: z
    .string()
    .min(1)
    .describe(
      "Stable key from the prompt registry. Today only `assistant.reasoner` is overridable.",
    ),
  newBody: z
    .string()
    .min(1)
    .describe("The proposed full new prompt body."),
  rationale: z
    .string()
    .min(1)
    .describe(
      "Plain-English explanation: what changed, why, and what it should improve.",
    ),
}).strict();

const OVERRIDABLE_KEYS = new Set<string>([PROMPT_KEYS.ASSISTANT_REASONER]);

/**
 * Compute a compact human-readable summary of how `proposed` differs
 * from `current`. We deliberately keep this lo-fi — line counts +
 * char delta + a short head/tail snippet of the new body. The chat
 * UI renders this alongside Apply / Reject buttons; the user is the
 * decision-maker, not us.
 */
function summarizeDiff(current: string, proposed: string): {
  charDelta: number;
  lineDelta: number;
  preview: string;
} {
  const charDelta = proposed.length - current.length;
  const currentLines = current.split("\n").length;
  const proposedLines = proposed.split("\n").length;
  const lineDelta = proposedLines - currentLines;
  const lines = proposed.split("\n");
  const head = lines.slice(0, 4).join("\n");
  const tail = lines.length > 8 ? `\n…\n${lines.slice(-3).join("\n")}` : "";
  const preview = `${head}${tail}`;
  return { charDelta, lineDelta, preview };
}

/**
 * `propose_prompt_edit` — Cookbook Library Phase C.
 *
 * The assistant's own "make yourself smarter" mechanism. It NEVER
 * writes to `app_prompt_overrides` directly — it only proposes a
 * structured edit + rationale. The chat UI renders the proposal as a
 * dedicated card with Apply / Reject buttons; the user is the only
 * principal that can commit the change.
 *
 * This is the explicit safety boundary: every edit to the assistant's
 * own behavior is user-approved. The tool's return payload includes
 * a `__proposal: "prompt_edit"` sentinel so the chat-sheet trace
 * renderer can special-case the row.
 */
export const proposePromptEditTool: AssistantTool = {
  name: "propose_prompt_edit",
  description:
    "Propose an edit to a registered prompt (e.g. your own base operating instructions). Does NOT write to the override store — only emits a proposal with a rationale + diff summary. The user clicks Apply in the chat to commit. Use this when the user asks you to 'remember' something, 'work like X', or you spot a flaw in your own behavior. Always read_my_system_prompt first so the diff is computed against reality.",
  parameters: {
    type: "object",
    properties: {
      promptKey: {
        type: "string",
        description:
          "Stable key. Currently overridable: `assistant.reasoner`.",
      },
      newBody: {
        type: "string",
        description: "The full proposed prompt body.",
      },
      rationale: {
        type: "string",
        description:
          "Plain-English explanation of the change + expected behavioral impact.",
      },
    },
    required: ["promptKey", "newBody", "rationale"],
    additionalProperties: false,
  },
  execute: async (rawArgs, ctx) => {
    const args = argsSchema.parse(rawArgs ?? {});
    const ownerId = ctx.ownerId ?? null;

    if (!OVERRIDABLE_KEYS.has(args.promptKey)) {
      const known = getCodePrompts().map((p) => p.key);
      return {
        ok: false,
        error: `Prompt key '${args.promptKey}' is not user-overridable. Overridable keys: ${known.join(", ")}.`,
      };
    }

    const resolved = await resolvePrompt(args.promptKey, ownerId);
    const summary = summarizeDiff(resolved.content, args.newBody);

    return {
      ok: true,
      __proposal: "prompt_edit" as const,
      promptKey: args.promptKey,
      currentBody: resolved.content,
      proposedBody: args.newBody,
      currentIsOverride: resolved.isOverride,
      rationale: args.rationale,
      summary,
      hint:
        "The user reviews this proposal in the chat (Apply / Reject). Do not assume it was applied — wait for the user's decision before changing your behavior.",
    };
  },
};
