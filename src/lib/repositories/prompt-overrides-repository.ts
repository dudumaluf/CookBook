/**
 * Cookbook Library Phase C — per-user prompt override repository contract.
 *
 * Backs `app_prompt_overrides`. The Library editor + the reasoner read
 * through this interface; tests can swap a fake via
 * `setPromptOverridesRepositoryForTests`.
 */

export interface PromptOverrideRecord {
  ownerId: string;
  promptKey: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type PromptOverrideErrorCode =
  | "not_found"
  | "unauthenticated"
  | "unknown";

export class PromptOverrideError extends Error {
  constructor(message: string, public code: PromptOverrideErrorCode) {
    super(message);
    this.name = "PromptOverrideError";
  }
}

export interface PromptOverridesRepository {
  /**
   * Read all overrides the user has set. Empty array when none.
   * Hot-path: called once per Library Prompts tab open + once per
   * reasoner call. Should be fast (single owner-scoped query).
   */
  list(ownerId: string): Promise<PromptOverrideRecord[]>;

  /** Read one override by key. Null when no override row exists. */
  get(
    ownerId: string,
    promptKey: string,
  ): Promise<PromptOverrideRecord | null>;

  /**
   * Upsert an override. Creates the row if missing; updates `body` (and
   * the `updated_at` trigger fires) if present. Returns the resulting
   * row so callers can immediately reflect timestamps in the UI.
   */
  upsert(
    ownerId: string,
    promptKey: string,
    body: string,
  ): Promise<PromptOverrideRecord>;

  /**
   * Remove an override (Reset → Default in the UI). No-op when the row
   * doesn't exist; never errors on missing rows.
   */
  remove(ownerId: string, promptKey: string): Promise<void>;
}
