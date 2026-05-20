/**
 * Hypothesis: the Higgsfield UI's "Soul Reference mode" might not use
 * custom_reference_id AT ALL — it just sends image_url to /soul/v2/standard
 * (or another endpoint) and the model uses the reference as a strong
 * style transfer target without any character lock.
 *
 * Test combinations:
 *   D: /soul/v2/standard + image_url, NO soul_id (i2i mode in Soul 2)
 *   E: /soul/v2/standard + image_url + soul_id + meaningful prompt
 *   F: /soul/v2/standard + image_url + soul_id + descriptive prompt of
 *      the reference (helps the model "see" the ref)
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
  console.log(`  body: ${JSON.stringify(body).slice(0, 200)}`);
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
    console.log(`  → ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
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
      console.log(`  → ${url}`);
      return url ?? null;
    }
    if (data.status === "failed" || data.status === "nsfw") {
      console.log(`  ${data.status}: ${data.message ?? "no detail"}`);
      return null;
    }
  }
  return null;
}

async function main() {
  const env = loadEnv();
  // 3 jobs in parallel — leaves 1 concurrent slot free.
  const [d, e, f] = await Promise.all([
    generate(
      env,
      "/higgsfield-ai/soul/v2/standard",
      {
        prompt: "a man",
        image_url: REF,
        aspect_ratio: "1:1",
        resolution: "720p",
      },
      "D: v2/standard + image_url, NO soul_id (i2i mode)",
    ),
    generate(
      env,
      "/higgsfield-ai/soul/v2/standard",
      {
        prompt: "portrait of a man with long hair, leather jacket, golden hour lighting, brown tones",
        custom_reference_id: SOUL_ID,
        image_url: REF,
        aspect_ratio: "1:1",
        resolution: "720p",
      },
      "E: v2/standard + image_url + soul_id + DESCRIPTIVE prompt",
    ),
    generate(
      env,
      "/higgsfield-ai/soul/reference",
      {
        prompt: "a man",
        custom_reference_id: SOUL_ID,
        image_url: REF,
        aspect_ratio: "1:1",
        resolution: "720p",
      },
      "F: /soul/reference + soul_id + minimal prompt 'a man'",
    ),
  ]);

  console.log("\n─── Summary ───");
  console.log(`  D (v2 i2i, no soul):              ${d ?? "FAILED"}`);
  console.log(`  E (v2 + soul + descriptive prompt): ${e ?? "FAILED"}`);
  console.log(`  F (/reference + soul + 'a man'):  ${f ?? "FAILED"}`);
}

main().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
