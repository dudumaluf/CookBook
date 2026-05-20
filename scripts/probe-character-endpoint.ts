/**
 * Free probe — submits to /higgsfield-ai/soul/character with our Soul ID and
 * IMMEDIATELY cancels the request (Higgsfield refunds credits when cancelled
 * before processing starts).
 *
 * If the submit succeeds (status: queued), we know the endpoint accepts our
 * payload shape. If it 422s, the error message tells us which fields are
 * required / which we got wrong.
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
  return {
    "hf-api-key": env.key,
    "hf-secret": env.secret,
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
  console.log(`\n[${label}]  POST ${url}`);
  console.log(`  body: ${JSON.stringify(body)}`);
  const res = await fetch(url, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`  → ${res.status}: ${text.slice(0, 600)}`);
  // If queued, attempt to cancel right away so we don't burn credits.
  try {
    const data = JSON.parse(text) as { request_id?: string };
    if (data.request_id) {
      const cancel = await fetch(
        `${API_BASE}/requests/${data.request_id}/cancel`,
        { method: "POST", headers: headers(env) },
      );
      console.log(`  cancelled: ${cancel.status}`);
    }
  } catch {
    /* ignore */
  }
}

async function main() {
  const env = loadEnv();
  console.log("[probe-character-endpoint]");

  // (a) /higgsfield-ai/soul/character with a Soul ID
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/character`,
    {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      aspect_ratio: "1:1",
      resolution: "720p",
    },
    "a) /soul/character + custom_reference_id",
  );

  // (b) Same endpoint, soul_id name instead
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/character`,
    {
      prompt: "test",
      soul_id: SOUL_ID,
      aspect_ratio: "1:1",
      resolution: "720p",
    },
    "b) /soul/character + soul_id (alternative field name)",
  );

  // (c) /higgsfield-ai/soul/v2/standard with a Soul ID — the current setup,
  // confirms whether the field is silently dropped (200 without complaining)
  // vs "field not allowed" (422)
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/v2/standard`,
    {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      aspect_ratio: "1:1",
      resolution: "720p",
    },
    "c) /soul/v2/standard + custom_reference_id (current setup)",
  );

  // (d) Try /higgsfield-ai/soul/v2/character — already 422'd earlier with
  // "Input should be 'standard'", but let's see if a fully populated body
  // changes the picture. (Probably not, but free to confirm.)
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/v2/character`,
    {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      aspect_ratio: "1:1",
      resolution: "720p",
    },
    "d) /soul/v2/character (expected 422 — sanity check)",
  );

  // (e) GET /v1/models or similar — see if Higgsfield exposes a model catalog
  console.log("\n[e]  GET /v1/models (might 404)");
  const m = await fetch(`${API_BASE}/v1/models`, { headers: headers(env) });
  console.log(`  → ${m.status}: ${(await m.text()).slice(0, 300)}`);

  console.log("\n[f]  GET /v1/text2image/models");
  const m2 = await fetch(`${API_BASE}/v1/text2image/models`, { headers: headers(env) });
  console.log(`  → ${m2.status}: ${(await m2.text()).slice(0, 300)}`);
}

main().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
