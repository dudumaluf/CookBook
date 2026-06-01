import { REASONER_INSTRUCTIONS } from "@/lib/assistant/instructions";

import type { PromptEntry } from "./types";

/**
 * Cookbook Library — code-defined prompt registry (Phase A).
 *
 * Lists every prompt that lives in source (not in the database). The
 * Prompts tab consumes this directly; Phase C will let users override
 * any of these via `app_prompt_overrides`.
 *
 * To add a new code-defined prompt:
 *   1. Declare the prompt as a const in its module (or extract one from
 *      an existing module so the const is exported).
 *   2. Add an entry below — pick a section, write a plain-English
 *      description of when it fires, point `content` at the const.
 *   3. Done. The Prompts tab picks it up on next load.
 *
 * KEEP THE DESCRIPTION FIELD HUMAN-READABLE. The Prompts tab is the
 * place where non-engineers learn how the system works — the
 * description is the docstring they read.
 */

/**
 * Stable keys for the registry entries. Centralized so future override
 * tables (Phase C) can reference them without typos.
 */
export const PROMPT_KEYS = {
  ASSISTANT_REASONER: "assistant.reasoner",
} as const;

/**
 * Returns the full set of code-defined prompts. Pure function — safe to
 * call from any UI render path; the result is a fresh array but the
 * underlying strings are constant module references.
 */
export function getCodePrompts(): PromptEntry[] {
  return [
    {
      key: PROMPT_KEYS.ASSISTANT_REASONER,
      title: "Assistant — base operating instructions",
      description:
        "The chat assistant's foundational rulebook. Tells it how to act inside the tool-calling loop: when to call tools, when to ask the user, how to phrase final messages, the cost discipline, the analyze-then-apply flow. Every chat session loads this prompt before the first turn.",
      section: "assistant",
      content: REASONER_INSTRUCTIONS,
    },
  ];
}
