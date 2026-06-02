/**
 * Assistant role contract — Cookbook Library Phase D1 (ADR-0061).
 */

export interface AssistantRole {
  /**
   * Stable id used by the role store + the role picker. Lowercase,
   * kebab-case. Persisted in localStorage as the active role choice.
   * Changing an existing id breaks user role-selection persistence —
   * don't.
   */
  id: string;
  /**
   * Short display label for the role chip in the chat-sheet header
   * (~12-22 chars). Title Case.
   */
  label: string;
  /**
   * One-line user-facing description shown in the role picker
   * popover. Present-tense, concrete. Avoid "the assistant will…" —
   * just describe the specialization ("Universal prompt-craft. Helps
   * you write, edit, and debug prompts for any model.").
   */
  description: string;
  /**
   * Markdown overlay appended to the static prefix of the system
   * prompt AFTER the base reasoner instructions. Empty string for
   * the General role (no-op specialization). Reasonable size:
   * 500-1500 characters per role. Anything bigger eats prompt-cache
   * benefit; anything smaller usually under-specifies.
   *
   * Cache strategy: the overlay rides inside the static prefix
   * (cached on Anthropic / Gemini), so the cost of the overlay is
   * paid once per session-per-role and discounted on every
   * subsequent turn. Switching roles invalidates the cache — that's
   * the explicit cost of a switch and is fine.
   */
  systemPromptOverlay: string;
}
