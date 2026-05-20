/**
 * Free investigation script — no image generation, no credits used.
 *
 * Three things to learn:
 *   1. The full character metadata from /v1/custom-references/{id} (singular).
 *      Hopefully includes a hint about which endpoint to use it with.
 *   2. The full last-status payload from a recent generation request that
 *      ignored our Soul ID, in case Higgsfield put an error/warning in a
 *      field we missed.
 *   3. Try a few alternative endpoint candidates with a HEAD/OPTIONS request
 *      and see which return 401 (means endpoint exists, our auth is wrong)
 *      vs 404 (means endpoint doesn't exist).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const API_BASE = "https://platform.higgsfield.ai";
const SOUL_ID = "b66a1caa-612f-440d-8353-debceb00aae6"; // Dudu Model

function loadEnv(): { key: string; secret: string } {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!;
  }
  return {
    key: env.HIGGSFIELD_API_KEY!,
    secret: env.HIGGSFIELD_API_SECRET!,
  };
}

function headers(env: { key: string; secret: string }) {
  return {
    "hf-api-key": env.key,
    "hf-secret": env.secret,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function describeCharacter(env: { key: string; secret: string }) {
  console.log(`\n[1] GET /v1/custom-references/${SOUL_ID}`);
  const res = await fetch(
    `${API_BASE}/v1/custom-references/${SOUL_ID}`,
    { headers: headers(env) },
  );
  const text = await res.text();
  console.log(`    status: ${res.status}`);
  try {
    console.log("    body:", JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log("    raw:", text.slice(0, 1000));
  }
}

async function listCharactersFully(env: { key: string; secret: string }) {
  console.log("\n[2] GET /v1/custom-references/list (full payload, page 1)");
  const res = await fetch(
    `${API_BASE}/v1/custom-references/list?page=1&page_size=20`,
    { headers: headers(env) },
  );
  const text = await res.text();
  console.log(`    status: ${res.status}`);
  try {
    const data = JSON.parse(text);
    console.log("    body:", JSON.stringify(data, null, 2));
  } catch {
    console.log("    raw:", text.slice(0, 1000));
  }
}

async function probeEndpoints(env: { key: string; secret: string }) {
  // Endpoints that might exist for Soul ID + v2 generation.
  const candidates = [
    "/higgsfield-ai/soul/v2/standard",
    "/higgsfield-ai/soul/v2/character",
    "/higgsfield-ai/soul/v2/reference",
    "/higgsfield-ai/soul/v2",
    "/higgsfield-ai/soul-2/standard",
    "/higgsfield-ai/soul/standard",
    "/higgsfield-ai/soul/character",
    "/v1/text2image/soul-2/standard",
    "/v1/text2image/soul/v2",
    "/v1/text2image/soul-v2",
  ];

  console.log("\n[3] probing endpoint existence (POST with empty body — 401/422 means exists)");
  for (const path of candidates) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: headers(env),
        body: JSON.stringify({}),
      });
      const text = await res.text();
      const snip = text.slice(0, 160).replace(/\s+/g, " ");
      console.log(`    ${res.status.toString().padStart(3)} ${path}  ::  ${snip}`);
    } catch (err) {
      console.log(`    ERR  ${path}  ::  ${(err as Error).message}`);
    }
  }
}

async function main() {
  const env = loadEnv();
  if (!env.key || !env.secret) {
    throw new Error("missing HIGGSFIELD_API_KEY/SECRET in .env.local");
  }
  console.log("[investigate-higgsfield] using key", env.key.slice(0, 8) + "…");

  await describeCharacter(env);
  await listCharactersFully(env);
  await probeEndpoints(env);
}

main().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
