#!/usr/bin/env node
/**
 * One-shot script — Slice 7.7 / ADR-0073. Walks
 * `src/app/api/**\/route.ts` and:
 *   1. Adds an import for `requireUser` if missing.
 *   2. Inserts the auth guard at the top of every exported HTTP handler
 *      (POST/GET/PATCH/DELETE/PUT) typed against `NextRequest`.
 *
 * Idempotent: skips files that already declare `__auth = await requireUser`.
 * Kept around as documentation of the original lockdown sweep; new routes
 * should add the guard inline.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const files = execSync('find src/app/api -type f -name "route.ts"', {
  cwd: ROOT,
  encoding: "utf8",
})
  .trim()
  .split("\n");

const HANDLER_RE =
  /export async function (POST|GET|PATCH|DELETE|PUT)\s*\(\s*([^)]*)\)\s*(?::\s*[^{]+)?\s*\{/g;

let touched = 0;
for (const rel of files) {
  const abs = `${ROOT}/${rel}`;
  let src = readFileSync(abs, "utf8");
  const before = src;

  if (src.includes("__auth = await requireUser")) {
    continue;
  }

  if (!src.includes("requireUser")) {
    if (/import [^;]*from "next\/server";\n/.test(src)) {
      src = src.replace(
        /(import [^;]*from "next\/server";\n)/,
        `$1import { requireUser } from "@/lib/auth/require-user";\n`,
      );
    } else {
      src =
        `import { requireUser } from "@/lib/auth/require-user";\n` + src;
    }
  }

  src = src.replace(HANDLER_RE, (match, _method, params) => {
    const reqMatch = params.match(/^\s*([A-Za-z_$][\w$]*)\b/);
    const reqVar = reqMatch ? reqMatch[1] : "req";
    if (!params.match(/NextRequest/)) {
      return match;
    }
    const guard =
      `\n  const __auth = await requireUser(${reqVar});\n` +
      `  if (__auth instanceof NextResponse) return __auth;\n`;
    return `${match}${guard}`;
  });

  if (src !== before) {
    writeFileSync(abs, src);
    touched++;
    console.log(`patched ${rel}`);
  }
}
console.log(`touched ${touched}/${files.length} files`);
