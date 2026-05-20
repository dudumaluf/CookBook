/**
 * Free probe (submit + immediate cancel) to map which endpoints accept the
 * v2-trained "Dudu Model" Soul ID without 422'ing.
 *
 * Goal: lock the dispatch matrix for HiggsfieldImageGen.execute() in
 * Slice 4.3:
 *
 *   variant === "v2"     → which endpoint ACTUALLY honours the character?
 *   variant === "cinema" → /soul/cinema (no styles)
 *   variant === "v1"     → /soul/{standard|character|reference}
 *
 * For now we have one v2 character on file — runs every plausible v2-mode
 * endpoint plus a few control comparisons. All requests are cancelled
 * within milliseconds → no credits consumed.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const API_BASE = "https://platform.higgsfield.ai";
const SOUL_ID = "b66a1caa-612f-440d-8353-debceb00aae6";

function loadEnv() {
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
  // Use the official `Authorization: Key` form (matches our route code).
  return {
    Authorization: `Key ${env.key}:${env.secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function probe(
  env: { key: string; secret: string },
  url: string,
  body: Record<string, unknown>,
  label: string,
) {
  console.log(`\n[${label}]`);
  const submit = await fetch(url, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify(body),
  });
  const text = await submit.text();
  console.log(`  → ${submit.status}: ${text.slice(0, 250)}`);
  // Cancel immediately if queued.
  try {
    const data = JSON.parse(text) as { request_id?: string };
    if (data.request_id) {
      const cancel = await fetch(
        `${API_BASE}/requests/${data.request_id}/cancel`,
        { method: "POST", headers: headers(env) },
      );
      console.log(`  cancel: ${cancel.status}`);
    }
  } catch {
    /* ignore */
  }
}

async function main() {
  const env = loadEnv();
  console.log(`[probe-variant-routing] using SoulID ${SOUL_ID.slice(0, 8)}…`);

  // (a) v2/standard with Soul ID — does it 200 silently?
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/v2/standard`,
    {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      aspect_ratio: "1:1",
      resolution: "720p",
    },
    "a) /soul/v2/standard + custom_reference_id",
  );

  // (b) v2/standard WITHOUT Soul ID — what's a clean baseline look like?
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/v2/standard`,
    { prompt: "test", aspect_ratio: "1:1", resolution: "720p" },
    "b) /soul/v2/standard WITHOUT character (control)",
  );

  // (c) /soul/character with v2 Soul ID — Prism says "won't honour", but
  // empirically it produced something that looked vaguely like the user.
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/character`,
    {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      aspect_ratio: "1:1",
      resolution: "720p",
    },
    "c) /soul/character (v1 mode) + v2 Soul ID",
  );

  // (d) Try the "list known models" endpoint to see if Higgsfield exposes
  // a proper catalogue we can read.
  console.log("\n[d] GET /v1/text2image/models");
  const models = await fetch(`${API_BASE}/v1/text2image/models`, {
    headers: headers(env),
  });
  console.log(`  → ${models.status}: ${(await models.text()).slice(0, 300)}`);

  // (e) GET on the platform root — sometimes leaks an OpenAPI spec.
  console.log("\n[e] GET /openapi.json");
  const spec = await fetch(`${API_BASE}/openapi.json`);
  console.log(`  → ${spec.status}`);
  if (spec.ok) {
    const json = (await spec.json()) as { paths?: Record<string, unknown> };
    const paths = Object.keys(json.paths ?? {});
    console.log(`  paths: ${paths.length}`);
    // Print just the soul-related ones.
    for (const p of paths.filter((p) => p.includes("soul"))) {
      console.log(`    ${p}`);
    }
  }
}

main().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
