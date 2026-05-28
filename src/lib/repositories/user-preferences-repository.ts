/**
 * UserPreferencesRepository — Slice 7.6 (ADR-0045).
 *
 * Single-row-per-owner JSONB blob the assistant reads + patches across
 * sessions / projects. The shape is intentionally free-form — the
 * assistant invents keys (preferred_aspect_ratio, preferred_style,
 * tone, etc.) over time as it learns.
 *
 * Same Repository pattern as the rest. Tests stub the interface.
 */

export interface UserPreferences {
  [key: string]: unknown;
}

export interface UserPreferencesRecord {
  ownerId: string;
  preferences: UserPreferences;
  updatedAt: string;
}

export interface UserPreferencesRepository {
  /** Read the prefs for an owner. Returns null when no row yet. */
  get(ownerId: string): Promise<UserPreferencesRecord | null>;
  /**
   * Upsert + shallow-merge a patch onto the existing prefs blob.
   * Set a value to `null` in the patch to delete that key.
   */
  patch(ownerId: string, patch: UserPreferences): Promise<UserPreferencesRecord>;
  /** Replace the whole prefs blob (rare — usually `patch` is enough). */
  set(ownerId: string, preferences: UserPreferences): Promise<UserPreferencesRecord>;
}

export class UserPreferencesError extends Error {
  readonly code: "not_found" | "permission_denied" | "network" | "unknown";
  constructor(message: string, code: UserPreferencesError["code"]) {
    super(message);
    this.name = "UserPreferencesError";
    this.code = code;
  }
}
