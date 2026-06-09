import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetMasterKeyForTests,
  decryptPayload,
  encryptPayload,
  fingerprint,
} from "@/lib/byok/crypto";

/**
 * BYOK encryption — Slice 7.7.
 *
 * Every test resets the master-key cache + restores `process.env`
 * after itself so the suite can mutate `BYOK_MASTER_KEY` without
 * leaking state into adjacent tests.
 */

const VALID_KEY_HEX = "a".repeat(64);
const VALID_KEY_HEX_2 = "b".repeat(64);

describe("byok/crypto", () => {
  let prevKey: string | undefined;

  beforeEach(() => {
    prevKey = process.env.BYOK_MASTER_KEY;
    process.env.BYOK_MASTER_KEY = VALID_KEY_HEX;
    _resetMasterKeyForTests();
  });

  afterEach(() => {
    if (prevKey === undefined) {
      delete process.env.BYOK_MASTER_KEY;
    } else {
      process.env.BYOK_MASTER_KEY = prevKey;
    }
    _resetMasterKeyForTests();
  });

  describe("encryptPayload + decryptPayload (round-trip)", () => {
    it("round-trips a simple ASCII string", () => {
      const out = encryptPayload("fal-key-12345");
      expect(out).not.toBe("fal-key-12345");
      expect(decryptPayload(out)).toBe("fal-key-12345");
    });

    it("round-trips a Higgsfield-style key:secret pair", () => {
      const plain = JSON.stringify({
        key: "hf_pub_xxxxxxxx",
        secret: "hf_secret_yyyyyyyyyyyyyy",
      });
      const ct = encryptPayload(plain);
      expect(JSON.parse(decryptPayload(ct))).toEqual({
        key: "hf_pub_xxxxxxxx",
        secret: "hf_secret_yyyyyyyyyyyyyy",
      });
    });

    it("round-trips multibyte / unicode payloads", () => {
      const plain = "🔑 chave-do-fal — αβγ 你好";
      expect(decryptPayload(encryptPayload(plain))).toBe(plain);
    });

    it("produces DIFFERENT ciphertext for the same plaintext (random IV)", () => {
      // Critical security property: IV must be fresh per call so two
      // encryptions of the same plaintext don't reveal "same input"
      // to a passive observer.
      const a = encryptPayload("same-input");
      const b = encryptPayload("same-input");
      expect(a).not.toBe(b);
      expect(decryptPayload(a)).toBe("same-input");
      expect(decryptPayload(b)).toBe("same-input");
    });
  });

  describe("tamper detection (GCM auth tag)", () => {
    it("decrypt fails when ciphertext bytes are flipped", () => {
      const ct = encryptPayload("original-secret");
      const bytes = Buffer.from(ct, "base64");
      // Flip one byte deep in the ciphertext region (past IV + auth tag).
      bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
      const tampered = bytes.toString("base64");
      expect(() => decryptPayload(tampered)).toThrow(/failed to decrypt/i);
    });

    it("decrypt fails when the auth tag itself is tampered", () => {
      const ct = encryptPayload("original-secret");
      const bytes = Buffer.from(ct, "base64");
      // Auth tag occupies bytes [12, 28). Flip a bit there.
      bytes[20] = bytes[20]! ^ 0x01;
      const tampered = bytes.toString("base64");
      expect(() => decryptPayload(tampered)).toThrow(/failed to decrypt/i);
    });

    it("decrypt fails when the master key is rotated mid-flight", () => {
      const ct = encryptPayload("rotation-test");
      // Caller rotates the master key without re-encrypting the row.
      process.env.BYOK_MASTER_KEY = VALID_KEY_HEX_2;
      _resetMasterKeyForTests();
      expect(() => decryptPayload(ct)).toThrow(/failed to decrypt/i);
    });
  });

  describe("master key validation", () => {
    it("throws a clear error when BYOK_MASTER_KEY is missing", () => {
      delete process.env.BYOK_MASTER_KEY;
      _resetMasterKeyForTests();
      expect(() => encryptPayload("anything")).toThrow(
        /BYOK_MASTER_KEY env var is missing/,
      );
    });

    it("throws when BYOK_MASTER_KEY isn't 64 hex chars", () => {
      process.env.BYOK_MASTER_KEY = "tooshort";
      _resetMasterKeyForTests();
      expect(() => encryptPayload("anything")).toThrow(
        /must be exactly 64 hex characters/,
      );
    });

    it("throws when BYOK_MASTER_KEY contains non-hex chars", () => {
      process.env.BYOK_MASTER_KEY = "z".repeat(64);
      _resetMasterKeyForTests();
      expect(() => encryptPayload("anything")).toThrow(
        /must be exactly 64 hex characters/,
      );
    });
  });

  describe("malformed ciphertext", () => {
    it("throws on empty string", () => {
      expect(() => decryptPayload("")).toThrow(
        /expects a non-empty string/,
      );
    });

    it("throws on payloads too short to contain IV + tag", () => {
      const tooShort = Buffer.from("short").toString("base64");
      expect(() => decryptPayload(tooShort)).toThrow(/too short/i);
    });
  });

  describe("fingerprint", () => {
    it("returns the last 4 chars of a single key", () => {
      expect(fingerprint("fal-key-abcdef1234")).toBe("1234");
    });

    it("returns the last 4 chars of the longer half of a key:secret pair", () => {
      // Higgsfield-style: usually the secret is longer + more meaningful.
      expect(fingerprint("shortkey:longer-secret-xyz9")).toBe("xyz9");
    });

    it("falls back to the last 4 of the whole string when halves are short / equal", () => {
      // 5 chars total, last 4 = "b:cd". Prevents leaking the prefix of
      // a too-short string while keeping the function's contract trivial.
      expect(fingerprint("ab:cd")).toBe("b:cd");
    });

    it("returns an empty string on empty / whitespace input", () => {
      expect(fingerprint("")).toBe("");
      expect(fingerprint("   ")).toBe("");
    });
  });
});
