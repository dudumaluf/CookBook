import type { AssistantRole } from "./types";

/**
 * General role — the default. Empty overlay; the base reasoner
 * instructions stand alone.
 *
 * Why exists at all (vs treating "no role" as null): the role registry
 * is iterable for the role picker UI, and the empty overlay is a
 * legitimate first option ("just the assistant, no specialization").
 * Picking General is also an explicit user choice that disables any
 * specialist behavior — `setRole("general")` reads as a return-to-
 * baseline action, not a "clear" action.
 */
export const GENERAL_ROLE: AssistantRole = {
  id: "general",
  label: "General",
  description: "Default — handles anything. No specialization.",
  systemPromptOverlay: "",
};
