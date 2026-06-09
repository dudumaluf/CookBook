#!/usr/bin/env node
/**
 * One-shot script — Slice 7.7 / ADR-0073. Refactors the
 * `src/lib/fal/*-api.ts` modules to:
 *
 *   1. Drop the `fal.config()` global singleton.
 *   2. Build a per-call `FalClient` via `buildFalClient(user)`.
 *   3. Add a trailing `user?: UserContext` param to every exported
 *      handler so routes can pass `requireUser` output through.
 *
 * Idempotent: skips files that already import `buildFalClient`.
 *
 * `image-api.ts` was migrated by hand and is intentionally excluded.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const FILES = execSync('ls src/lib/fal/*-api.ts', { cwd: ROOT, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => !f.endsWith("image-api.ts"));

let touched = 0;
for (const rel of FILES) {
  const abs = `${ROOT}/${rel}`;
  let src = readFileSync(abs, "utf8");
  if (src.includes("buildFalClient")) {
    console.log(`SKIP ${rel} (already migrated)`);
    continue;
  }
  if (!src.includes('import { fal } from "@fal-ai/client";')) {
    console.log(`SKIP ${rel} (no fal singleton import)`);
    continue;
  }

  // 1. Swap the import line for the BYOK-aware client factory.
  src = src.replace(
    /import \{ fal \} from "@fal-ai\/client";\s*\n/,
    `import type { UserContext } from "@/lib/byok/resolver";\nimport { MissingCredentialsError } from "@/lib/byok/resolver";\n\nimport { buildFalClient } from "./client-factory";\n`,
  );

  // 2. Strip the singleton state + ensureConfigured().
  src = src.replace(
    /let configured = false;\s*\nfunction ensureConfigured\(\): void \{[\s\S]*?\n\}\n\n?/,
    "",
  );

  // 3. Add `user?: UserContext` param to every exported async function
  //    that takes `signal: AbortSignal` as its last typed param. The
  //    regex looks for the closing `signal: AbortSignal,?` line and
  //    appends `  user?: UserContext,` after it (preserving indent).
  src = src.replace(
    /(\bexport async function [A-Za-z0-9_]+\([\s\S]*?signal:\s*AbortSignal),(\n\): )/g,
    "$1,\n  user?: UserContext,$2",
  );
  src = src.replace(
    /(\bexport async function [A-Za-z0-9_]+\([\s\S]*?signal:\s*AbortSignal)(\n\): )/g,
    (m, head, tail) => {
      // Skip if `user?: UserContext` already inserted (idempotent guard).
      if (head.includes("user?: UserContext")) return m;
      return `${head},\n  user?: UserContext,${tail}`;
    },
  );

  // 4. Replace `ensureConfigured();` with the bound client setup.
  src = src.replace(
    /ensureConfigured\(\);\s*\n/g,
    `let __bound;\n  try {\n    __bound = await buildFalClient(user);\n  } catch (err) {\n    if (err instanceof MissingCredentialsError) {\n      throw annotate(new Error(err.message), "missing_key");\n    }\n    throw err;\n  }\n  const { client: fal } = __bound;\n`,
  );

  writeFileSync(abs, src);
  touched++;
  console.log(`patched ${rel}`);
}
console.log(`touched ${touched}/${FILES.length} files`);
