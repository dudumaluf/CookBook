/**
 * Free probe — submits and immediately cancels (202 = refund) to figure out:
 *
 * 1. Does `/soul/v2/standard` accept `custom_reference_id` AND `quality: "2k"`
 *    (the Prism shape) without 422'ing? Status response body might include
 *    a hint about whether the character was honored or dropped.
 * 2. Are there v2-specific character endpoints we haven't probed yet?
 * 3. What's in the queue response payload — any field that shows which
 *    pipeline / variant was actually picked?
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
  console.log(`\n[${label}]`);
  console.log(`  POST ${url}`);
  console.log(`  body: ${JSON.stringify(body)}`);
  const res = await fetch(url, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`  → ${res.status}`);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
    console.log(`  body:`, JSON.stringify(parsed, null, 2).split("\n").slice(0, 30).join("\n"));
  } catch {
    console.log(`  raw: ${text.slice(0, 800)}`);
  }
  // Cancel immediately if queued so we don't burn credits on this probe.
  if (parsed && typeof parsed === "object" && "request_id" in parsed) {
    const rid = (parsed as { request_id: string }).request_id;

    // Read status ONCE before cancelling — the queue submit response and the
    // first status read are usually where pipeline metadata leaks (model
    // routing, character lock confirmation, etc.).
    const stat = await fetch(`${API_BASE}/requests/${rid}/status`, {
      headers: headers(env),
    });
    const statText = await stat.text();
    console.log(`  status (pre-cancel) → ${stat.status}: ${statText.slice(0, 600)}`);

    const cancel = await fetch(`${API_BASE}/requests/${rid}/cancel`, {
      method: "POST",
      headers: headers(env),
    });
    console.log(`  cancel → ${cancel.status}`);
  }
}

async function main() {
  const env = loadEnv();
  console.log("[probe-v2-with-character]");

  // (a) v2/standard + character + quality "2k" — Prism's Soul 2 shape exactly.
  // This is what we need to know: does the queue body or the first status
  // poll hint at whether the character was honored?
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/v2/standard`,
    {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      aspect_ratio: "1:1",
      quality: "2k",
    },
    "a) /soul/v2/standard + custom_reference_id + quality:2k (Prism shape)",
  );

  // (b) Same but with quality "1.5k"
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/v2/standard`,
    {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      aspect_ratio: "1:1",
      quality: "1.5k",
    },
    "b) /soul/v2/standard + custom_reference_id + quality:1.5k",
  );

  // (c) Try a "character" mode hint as a body field, in case it dispatches
  // server-side
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/v2/standard`,
    {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      aspect_ratio: "1:1",
      quality: "2k",
      mode: "character",
    },
    "c) /soul/v2/standard + body.mode='character' (long shot)",
  );

  // (d) /soul/character — the v1 character mode. Get its first-status
  // payload to see if it leaks the variant being used.
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/character`,
    {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      aspect_ratio: "1:1",
      resolution: "720p",
    },
    "d) /soul/character (v1 character mode) — get pipeline metadata",
  );

  // (e) Same /soul/character with quality:2k instead of resolution:720p
  await probe(
    env,
    `${API_BASE}/higgsfield-ai/soul/character`,
    {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      aspect_ratio: "1:1",
      quality: "2k",
    },
    "e) /soul/character + quality:2k",
  );
}

main().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
