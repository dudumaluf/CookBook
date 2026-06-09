import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * BYOK encryption (Slice 7.7 / ADR-0073).
 *
 * Provider API keys (Fal, Higgsfield, OpenAI, …) are encrypted BEFORE
 * they hit the database with AES-256-GCM. The DB only ever stores
 * ciphertext — Postgres logs, snapshots, replication, support staff
 * queries can never see plaintext keys.
 *
 * ## Format
 *
 * Output is a single base64 string with the layout:
 *
 *     [12-byte IV][16-byte AuthTag][N-byte ciphertext]
 *
 * IV is a fresh `randomBytes(12)` per call (NIST SP 800-38D §8.2). The
 * AuthTag is GCM's built-in MAC — any tampering with the ciphertext
 * fails decrypt with `bad-decrypt`. We DO NOT include a version byte
 * because there's only one format today; if/when we rotate algorithms
 * (e.g. add ChaCha20-Poly1305, switch from `BYOK_MASTER_KEY` v1 to
 * v2), prepend a magic byte at that point — the migration path is
 * "decrypt-with-old, re-encrypt-with-new" anyway, so a version byte
 * gives us nothing right now.
 *
 * ## Master key
 *
 * `BYOK_MASTER_KEY` lives in Vercel env vars (server-side only; never
 * `NEXT_PUBLIC_`). Must be 32 random bytes encoded as 64 hex chars.
 * Generate with:
 *
 *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * ## Rotation
 *
 * Losing the key bricks every stored credential (intentional — that's
 * the threat model). To rotate:
 *
 *   1. Generate new master key.
 *   2. Read all rows with old key, decrypt to plaintext in memory.
 *   3. Re-encrypt with new key.
 *   4. Write back.
 *   5. Swap `BYOK_MASTER_KEY` env var to the new one.
 *
 * A future `pnpm tsx scripts/rotate-byok-master-key.ts` can automate
 * this; for now it's a documented manual procedure.
 *
 * ## Why app-level instead of pgcrypto / Supabase Vault
 *
 *   - Plaintext NEVER touches the DB (even in transit). pgcrypto sees
 *     plaintext during `pgp_sym_encrypt(plain, key)`.
 *   - One Vercel secret to rotate, no DB extension to install.
 *   - Identical behavior in local dev and prod.
 *   - Simpler test surface: pure functions, no infra dependency.
 *
 * The downside (lose key → bricked credentials) is an acceptable
 * trade-off for a feature where the user is bringing their own
 * recoverable secret (they can always re-paste their Fal key from
 * the Fal dashboard).
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_HEX_LENGTH = 64; // 32 bytes = 256 bits = 64 hex chars

/**
 * Cached master key buffer. We resolve once per process and reuse —
 * `process.env.BYOK_MASTER_KEY` doesn't change at runtime, and parsing
 * it on every call would be wasteful (and noisier in logs if missing).
 */
let cachedMasterKey: Buffer | null = null;

function loadMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  const raw = process.env.BYOK_MASTER_KEY?.trim();
  if (!raw) {
    throw new Error(
      "BYOK is not configured: BYOK_MASTER_KEY env var is missing. Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` and add it to Vercel + .env.local.",
    );
  }
  if (raw.length !== KEY_HEX_LENGTH || !/^[0-9a-f]+$/i.test(raw)) {
    throw new Error(
      `BYOK_MASTER_KEY must be exactly ${KEY_HEX_LENGTH} hex characters (32 bytes). Got ${raw.length} chars.`,
    );
  }
  cachedMasterKey = Buffer.from(raw, "hex");
  return cachedMasterKey;
}

/** Test-only: clear the cached key so a unit test can swap env vars mid-suite. */
export function _resetMasterKeyForTests(): void {
  cachedMasterKey = null;
}

/**
 * Encrypt an arbitrary plaintext payload (JSON, string, …) and return
 * a single base64 string ready to land in the
 * `cookbook_provider_keys.encrypted_payload` column.
 *
 * Callers should JSON-stringify their payload BEFORE calling this so
 * the format is uniform across providers (Fal `{key}` vs Higgsfield
 * `{key, secret}` etc.).
 */
export function encryptPayload(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("encryptPayload expects a string");
  }
  const masterKey = loadMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString("base64");
}

/**
 * Decrypt a base64 payload previously produced by `encryptPayload`.
 * Throws on malformed input, wrong key, or tampered ciphertext —
 * GCM's auth tag makes the last case detectable.
 *
 * Callers should JSON.parse the returned string per their provider's
 * shape.
 */
export function decryptPayload(encrypted: string): string {
  if (typeof encrypted !== "string" || encrypted.length === 0) {
    throw new TypeError("decryptPayload expects a non-empty string");
  }
  const masterKey = loadMasterKey();
  let buf: Buffer;
  try {
    buf = Buffer.from(encrypted, "base64");
  } catch {
    throw new Error("decryptPayload: input is not valid base64");
  }
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error(
      "decryptPayload: input too short to be a valid AES-GCM payload",
    );
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);
  try {
    const dec = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch (err) {
    // GCM auth tag mismatch surfaces as "Unsupported state or unable to
    // authenticate data" — translate to a clearer message so callers
    // can surface "key tampered with or master key changed" without
    // leaking implementation detail.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `decryptPayload: failed to decrypt (likely tampered ciphertext or BYOK_MASTER_KEY changed): ${msg}`,
    );
  }
}

/**
 * Build the public `key_fingerprint` shown in the UI. Last 4 chars of
 * the underlying API key (or the longer half of a `key:secret` pair).
 * Short enough that it can't be reverse-engineered into the full key,
 * long enough for the user to confirm "yes that's the key I set."
 */
export function fingerprint(key: string): string {
  const trimmed = (key ?? "").trim();
  if (trimmed.length === 0) return "";
  // For Higgsfield-style `key:secret` pairs, take the longer side
  // (usually the secret, which is the more meaningful identifier).
  const halves = trimmed.split(":");
  const meaningful =
    halves.length === 2 && halves[1]!.length > halves[0]!.length
      ? halves[1]!
      : trimmed;
  return meaningful.slice(-4);
}
