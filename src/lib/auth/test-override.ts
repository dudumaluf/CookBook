/**
 * Test-only override store for `requireUser`. Lives in its own
 * module so `tests/setup.ts` can flip the override without
 * transitively pulling in `@supabase/supabase-js` (which would
 * lock the module's `createClient` binding before per-test mocks
 * can apply).
 */

let override: { userId: string; accessToken: string } | null = null;

export function _setRequireUserOverrideForTests(
  user: { userId: string; accessToken: string } | null,
): void {
  override = user;
}

export function _getRequireUserOverride(): {
  userId: string;
  accessToken: string;
} | null {
  return override;
}
