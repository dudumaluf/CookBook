/**
 * BYOK shared types — Slice 7.7 / ADR-0073.
 *
 * The list of providers + per-provider plaintext shape lives here so
 * the repository, the API routes, the resolver, and the UI all agree
 * on what valid input looks like. New providers add an entry here +
 * an entry in `migrations/20260609_provider_keys_byok.sql`'s `check`
 * constraint.
 */

export const BYOK_PROVIDERS = [
  "fal",
  "higgsfield",
  "openai",
  "anthropic",
  "replicate",
  "google",
] as const;

export type BYOKProvider = (typeof BYOK_PROVIDERS)[number];

export function isBYOKProvider(v: unknown): v is BYOKProvider {
  return (
    typeof v === "string" &&
    (BYOK_PROVIDERS as readonly string[]).includes(v)
  );
}

/**
 * Per-provider plaintext shape. The repository encrypts this whole
 * object as JSON before persisting; the resolver decrypts + parses
 * it. UI never sees the decrypted form, only the `key_fingerprint`
 * that comes back as a public field.
 */
export interface BYOKPayloads {
  fal: { key: string };
  higgsfield: { key: string; secret: string };
  openai: { key: string };
  anthropic: { key: string };
  replicate: { key: string };
  google: { key: string };
}

export type BYOKPayload<P extends BYOKProvider = BYOKProvider> =
  BYOKPayloads[P];

/**
 * Public-shape row that's safe to send to the browser. Notice the
 * absence of `encrypted_payload` — the UI never sees ciphertext, only
 * the fingerprint + enable flag + timestamps so it can render a row
 * like "Fal • ••••abc1 • Enabled".
 */
export interface BYOKKeyRecord {
  provider: BYOKProvider;
  fingerprint: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
