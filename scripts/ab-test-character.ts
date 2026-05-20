/**
 * A/B test: same Soul ID + same prompt to two endpoints, in parallel.
 *
 *   A) /higgsfield-ai/soul/v2/standard  + quality:"2k" + custom_reference_id
 *      ↳ This is what Prism documented as "Soul 2" — full v2 quality WITH
 *        character lock if Higgsfield's docs are accurate. If output isn't
 *        the user, the v2/standard endpoint silently drops Soul ID.
 *
 *   B) /higgsfield-ai/soul/character    + quality:"2k" + custom_reference_id
 *      ↳ The empirically-verified-yesterday "this works" endpoint. Probably
 *        v1 character mode but renders with the user's likeness.
 *
 * Both use the hf-api-key / hf-secret auth headers (Prism's shape — also
 * empirically-verified-yesterday as the Soul-ID-honouring auth).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const API_BASE = "https://platform.higgsfield.ai";
const SOUL_ID = "b66a1caa-612f-440d-8353-debceb00aae6";
// Same prompt for both so the comparison is apples-to-apples.
const PROMPT =
  "an editorial portrait of a man, soft window light, neutral background, photoreal, head and shoulders fully in frame";

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

async function generateAt(
  env: { key: string; secret: string },
  url: string,
  body: Record<string, unknown>,
  label: string,
): Promise<string> {
  console.log(`[${label}] submitting…`);
  const submit = await fetch(url, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    throw new Error(
      `[${label}] submit ${submit.status}: ${(await submit.text()).slice(0, 400)}`,
    );
  }
  const queued = (await submit.json()) as {
    request_id: string;
  };
  console.log(`[${label}] queued: ${queued.request_id}`);

  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000));
    const stat = await fetch(
      `${API_BASE}/requests/${queued.request_id}/status`,
      { headers: headers(env) },
    );
    if (!stat.ok) {
      throw new Error(
        `[${label}] status ${stat.status}: ${(await stat.text()).slice(0, 400)}`,
      );
    }
    const data = (await stat.json()) as {
      status: string;
      images?: Array<{ url?: string }>;
      message?: string;
    };
    process.stdout.write(`[${label}] status=${data.status}\n`);
    if (data.status === "completed") {
      const imageUrl = data.images?.[0]?.url;
      if (!imageUrl) throw new Error(`[${label}] completed but no url`);
      return imageUrl;
    }
    if (data.status === "nsfw") throw new Error(`[${label}] NSFW`);
    if (data.status === "failed") {
      throw new Error(`[${label}] failed: ${data.message ?? "no detail"}`);
    }
  }
  throw new Error(`[${label}] timeout`);
}

async function main() {
  const env = loadEnv();
  console.log(
    `[ab-test-character] running A and B in parallel for Soul ID ${SOUL_ID.slice(0, 8)}…\n`,
  );

  const results = await Promise.allSettled([
    generateAt(
      env,
      `${API_BASE}/higgsfield-ai/soul/v2/standard`,
      {
        prompt: PROMPT,
        custom_reference_id: SOUL_ID,
        aspect_ratio: "1:1",
        quality: "2k",
      },
      "A: /soul/v2/standard quality:2k",
    ),
    generateAt(
      env,
      `${API_BASE}/higgsfield-ai/soul/character`,
      {
        prompt: PROMPT,
        custom_reference_id: SOUL_ID,
        aspect_ratio: "1:1",
        quality: "2k",
      },
      "B: /soul/character quality:2k",
    ),
  ]);

  console.log("\n[ab-test-character] summary:");
  const labels = ["A: /soul/v2/standard", "B: /soul/character"];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      console.log(`  ✓ ${labels[i]}  →  ${r.value}`);
    } else {
      console.log(`  ✗ ${labels[i]}  →  ${r.reason?.message ?? r.reason}`);
    }
  });
}

main().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
