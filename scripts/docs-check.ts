#!/usr/bin/env tsx
/**
 * docs-check
 *
 * Verifies that every doc referenced from docs/INDEX.md actually exists on disk.
 * Run by `npm run docs:check`. Used as a soft gate in CI later.
 *
 * Fails (exit 1) on the first missing doc with a useful message.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const indexPath = resolve(repoRoot, "docs/INDEX.md");

if (!existsSync(indexPath)) {
  console.error(`[docs-check] FAIL: docs/INDEX.md is missing at ${indexPath}.`);
  process.exit(1);
}

const indexContents = readFileSync(indexPath, "utf-8");

// Match markdown links of the form (./Something.md) — relative paths inside docs/
const linkPattern = /\(\.\/([\w\-./]+\.md)\)/g;
const declared = new Set<string>();
for (const m of indexContents.matchAll(linkPattern)) {
  declared.add(m[1]!);
}

if (declared.size === 0) {
  console.error("[docs-check] FAIL: docs/INDEX.md has no relative links to verify.");
  process.exit(1);
}

const missing: string[] = [];
for (const rel of declared) {
  const abs = resolve(repoRoot, "docs", rel);
  if (!existsSync(abs)) missing.push(rel);
}

if (missing.length > 0) {
  console.error("[docs-check] FAIL: the following docs are referenced from INDEX.md but missing:");
  for (const m of missing) console.error(`  - docs/${m}`);
  console.error("\nFix: either create the missing files or remove the links from INDEX.md.");
  process.exit(1);
}

console.log(`[docs-check] OK: ${declared.size} docs verified.`);
for (const d of declared) console.log(`  \u2713 docs/${d}`);
