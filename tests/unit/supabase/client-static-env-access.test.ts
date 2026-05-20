import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression test for the Slice 2.3 env-loading bug.
 *
 * Next.js / Turbopack only statically inline literal `process.env.NEXT_PUBLIC_*`
 * accesses at build time — dynamic lookups (`process.env[name]`) stay as
 * runtime reads against an empty object in the browser bundle, so the
 * values come back `undefined` even when `.env.local` is loaded.
 *
 * This test reads the supabase client source and fails if anyone
 * (re)introduces a dynamic env read for a `NEXT_PUBLIC_*` variable in
 * this file. Cheap & cheerful — catches the regression at unit-test time
 * instead of "upload failed in the browser" time.
 */
describe("supabase/client.ts — env reads must be statically inlinable", () => {
  const fullSrc = readFileSync(
    resolve(__dirname, "../../../src/lib/supabase/client.ts"),
    "utf-8",
  );
  // Strip comments before scanning so our own documentation of the
  // anti-pattern doesn't trip the regex. Naive single-line strip is fine
  // here — multiline `/* ... */` is the only other comment style and we
  // can drop those greedily too.
  const codeOnly = fullSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("never reads NEXT_PUBLIC_* through a dynamic key", () => {
    // `process.env[ANYTHING]` is the broken shape. The good shape is
    // process.env.NEXT_PUBLIC_FOO (literal dot access — kept out of a
    // formatted code expression here on purpose so the regex doesn't
    // self-trip if the comment ever escapes the strip).
    const dynamicLookup = /process\.env\[/;
    expect(dynamicLookup.test(codeOnly)).toBe(false);
  });

  it("references each required env var as a literal property", () => {
    for (const name of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ASSETS_BUCKET",
    ]) {
      const literal = new RegExp(`process\\.env\\.${name}\\b`);
      expect(literal.test(codeOnly)).toBe(true);
    }
  });
});
