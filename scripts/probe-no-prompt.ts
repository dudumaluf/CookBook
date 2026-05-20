/**
 * Test what happens with NO prompt, just Soul ID + image_url.
 *
 * The user's intuition from the Higgsfield UI: "without a prompt, the
 * reference image transfers MUCH more strongly". We've been sending a
 * prompt every time which may be diluting the reference signal. Probe:
 *
 *   1. /soul/v2/standard with empty/missing prompt + image_url + soul_id
 *      (does the API even accept it?)
 *   2. /soul/reference with empty prompt
 *   3. /soul/v2/standard with a SHORT minimal prompt vs the long one
 *
 * The probe submits real generations (no cancel) so we can compare
 * outputs visually. Costs ~3 credits.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const API = "https://platform.higgsfield.ai";
const SOUL_ID = "b66a1caa-612f-440d-8353-debceb00aae6";
const REF =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Matthew_McConaughey_2019_by_Glenn_Francis.jpg/640px-Matthew_McConaughey_2019_by_Glenn_Francis.jpg";

async function generate(
  env: { key: string; secret: string },
  endpoint: string,
  body: Record<string, unknown>,
  label: string,
): Promise<string | null> {
  console.log(`\n[${label}]`);
  console.log(`  POST ${endpoint}`);
  console.log(`  body: ${JSON.stringify(body)}`);
  const headers = {
    Authorization: `Key ${env.key}:${env.secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const submit = await fetch(`${API}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    const text = await submit.text();
    console.log(`  → ${submit.status}: ${text.slice(0, 200)}`);
    return null;
  }
  const queued = (await submit.json()) as { request_id: string };
  console.log(`  queued: ${queued.request_id}`);
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await fetch(`${API}/requests/${queued.request_id}/status`, {
      headers,
    });
    const data = (await r.json()) as {
      status: string;
      images?: Array<{ url?: string }>;
      message?: string;
    };
    if (data.status === "completed") {
      const url = data.images?.[0]?.url;
      console.log(`  status=completed → ${url}`);
      return url ?? null;
    }
    if (data.status === "failed" || data.status === "nsfw") {
      console.log(`  ${data.status}: ${data.message ?? "no detail"}`);
      return null;
    }
  }
  console.log("  TIMEOUT");
  return null;
}

async function main() {
  const env = loadEnv();

  // Run all 3 in parallel — 3 of 4 concurrent slots used, 1 free.
  const [r1, r2, r3] = await Promise.all([
    generate(
      env,
      "/higgsfield-ai/soul/v2/standard",
      {
        prompt: " ",
        custom_reference_id: SOUL_ID,
        image_url: REF,
        aspect_ratio: "1:1",
        resolution: "720p",
      },
      "A: /soul/v2/standard, prompt=' ' (single space)",
    ),
    generate(
      env,
      "/higgsfield-ai/soul/reference",
      {
        prompt: " ",
        custom_reference_id: SOUL_ID,
        image_url: REF,
        aspect_ratio: "1:1",
        resolution: "720p",
      },
      "B: /soul/reference, prompt=' '",
    ),
    generate(
      env,
      "/higgsfield-ai/soul/v2/standard",
      {
        // No prompt field at all — see what the schema accepts
        custom_reference_id: SOUL_ID,
        image_url: REF,
        aspect_ratio: "1:1",
        resolution: "720p",
      },
      "C: /soul/v2/standard, NO prompt field at all",
    ),
  ]);

  console.log("\n─── Summary ───");
  console.log(`  A (v2/standard, prompt=' '):  ${r1 ?? "FAILED"}`);
  console.log(`  B (/reference, prompt=' '):   ${r2 ?? "FAILED"}`);
  console.log(`  C (v2/standard, no prompt):   ${r3 ?? "FAILED"}`);
}

main().catch((e) => {
  console.error("FAIL:", e.message ?? e);
  process.exit(1);
});
