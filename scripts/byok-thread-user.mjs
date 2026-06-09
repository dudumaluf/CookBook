#!/usr/bin/env node
/**
 * One-shot script — Slice 7.7 / ADR-0073. Walks every route handler
 * under `src/app/api/{fal,higgsfield,llm}/` and threads the
 * `__auth.userId` + `__auth.accessToken` user context through to the
 * corresponding `*-api` library calls.
 *
 * Pattern matched: `await <fnName>(<args ending in req.signal>)` for
 * functions that come from a known `*-api` module. The script
 * appends `, { userId: __auth.userId, accessToken: __auth.accessToken }`
 * before the closing paren.
 *
 * Idempotent: skips calls that already pass `__auth.userId`.
 *
 * Kept as documentation of the original BYOK threading sweep.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const FILES = execSync(
  'find src/app/api -type f -name "route.ts"',
  { cwd: ROOT, encoding: "utf8" },
)
  .trim()
  .split("\n");

// Functions whose call sites should be threaded with user context.
// (Each maps to an exported helper in a `*-api.ts` BYOK-aware module.)
const THREAD_FUNCS = new Set([
  // Fal
  "generateFalImage",
  "submitSeedanceVideo",
  "getSeedanceResult",
  "submitHunyuan3d",
  "getHunyuan3dResult",
  "submitMarlin",
  "getMarlinResult",
  "submitAudioIsolation",
  "getAudioIsolationResult",
  "submitScribeV2",
  "getScribeV2Result",
  "submitHeygenLipsync",
  "getHeygenLipsyncResult",
  // Higgsfield
  "generateSoulImage",
  "listSoulIds",
  "listSoulStyles",
  "createSoulId",
  "getSoulId",
  "deleteSoulId",
  // LLM
  "callChatCompletions",
]);

let touched = 0;
for (const rel of FILES) {
  const abs = `${ROOT}/${rel}`;
  let src = readFileSync(abs, "utf8");
  const before = src;

  for (const fn of THREAD_FUNCS) {
    // Match `await fn(... req.signal)` where the closing `)` directly
    // follows `req.signal` or `req.signal,` (no existing user arg).
    const re = new RegExp(
      `await\\s+${fn}\\s*\\(([^)]*?req\\.signal\\s*,?)\\s*\\)`,
      "g",
    );
    src = src.replace(re, (m, args) => {
      if (m.includes("__auth.userId")) return m;
      const cleanedArgs = args.replace(/,\s*$/, "");
      return `await ${fn}(${cleanedArgs}, { userId: __auth.userId, accessToken: __auth.accessToken })`;
    });
  }

  if (src !== before) {
    writeFileSync(abs, src);
    touched++;
    console.log(`patched ${rel}`);
  }
}
console.log(`touched ${touched}/${FILES.length} files`);
