import { getCodePrompts, PROMPT_KEYS } from "@/lib/prompts/registry";
import { getPromptOverridesRepository } from "@/lib/repositories/supabase-prompt-overrides-repository";

/**
 * Cookbook Library Phase C — prompt resolution.
 *
 * `resolvePrompt(key, ownerId)` returns the body the system should
 * actually use for `key`:
 *
 *   - If the user has an override row in `app_prompt_overrides` for
 *     this `(ownerId, key)`, the override body wins.
 *   - Otherwise the bundled default from `getCodePrompts()` is
 *     returned unchanged.
 *
 * `isOverride` lets callers (the chat override badge, the
 * `read_my_system_prompt` tool) tell which path was taken without a
 * second lookup.
 *
 * Defensive on the unauth path: if `ownerId` is null / undefined we
 * skip the DB hit and return the default. Same on a network blip — we
 * never reject; failing open keeps the assistant working even when
 * the override DB is briefly unreachable, falling back to defaults.
 */

export interface ResolvedPrompt {
  /** The body to inject (override OR default). */
  content: string;
  /** True when the override row was hit; false when default. */
  isOverride: boolean;
  /** The default the registry shipped — used by the editor's "vs default" pane. */
  defaultContent: string;
  /** When the override was last updated; null on default. */
  updatedAt: string | null;
}

export async function resolvePrompt(
  promptKey: string,
  ownerId: string | null | undefined,
): Promise<ResolvedPrompt> {
  const defaults = getCodePrompts();
  const def = defaults.find((p) => p.key === promptKey);
  const defaultContent = def?.content ?? "";

  if (!ownerId) {
    return {
      content: defaultContent,
      isOverride: false,
      defaultContent,
      updatedAt: null,
    };
  }

  try {
    const row = await getPromptOverridesRepository().get(ownerId, promptKey);
    if (!row) {
      return {
        content: defaultContent,
        isOverride: false,
        defaultContent,
        updatedAt: null,
      };
    }
    return {
      content: row.body,
      isOverride: true,
      defaultContent,
      updatedAt: row.updatedAt,
    };
  } catch (err) {
    console.warn("[resolve-prompt] override fetch failed, falling back:", err);
    return {
      content: defaultContent,
      isOverride: false,
      defaultContent,
      updatedAt: null,
    };
  }
}

/**
 * Convenience: returns ONLY the body. Preferred by call sites that
 * don't need the meta (e.g. the runtime reasoner).
 */
export async function getResolvedPromptBody(
  promptKey: string,
  ownerId: string | null | undefined,
): Promise<string> {
  return (await resolvePrompt(promptKey, ownerId)).content;
}

export { PROMPT_KEYS };
