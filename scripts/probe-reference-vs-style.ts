/**
 * Free-ish probe to answer two questions definitively:
 *
 *   Q1. Is the reference image actually being honoured by /soul/v2/standard?
 *       Compare the SAME prompt + SAME Soul ID + SAME seed with vs without
 *       a reference. If the reference is honoured, the two images differ
 *       in pose / framing / lighting (the reference's composition leaks
 *       into the output). If it's silently dropped, the two are
 *       near-identical (same seed, same Soul ID = same output).
 *
 *   Q2. Without an image reference, can I list available Soul Style
 *       presets and pick one? Hits /v1/text2image/soul-styles/v2 (the
 *       v2-curated catalogue per ADR-0029).
 *
 * Costs: 2 generations (1 with ref + 1 without). Defaults to 720p +
 * batch 1 — about 2 credits total.
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

function headers(env: { key: string; secret: string }) {
  return {
    Authorization: `Key ${env.key}:${env.secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

const API = "https://platform.higgsfield.ai";
const SOUL_ID = "b66a1caa-612f-440d-8353-debceb00aae6";
// Public reference image — using Matthew McConaughey-as-detective stock-ish
// photo because it's distinctive (long hair, leather jacket, brown tones)
// so any influence of the reference on the output is easy to spot. Same
// idea as your manual canvas test.
const REFERENCE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Matthew_McConaughey_2019_by_Glenn_Francis.jpg/640px-Matthew_McConaughey_2019_by_Glenn_Francis.jpg";
const PROMPT = "a man";
const SEED = 424242;

async function generate(
  env: { key: string; secret: string },
  body: Record<string, unknown>,
  label: string,
): Promise<string> {
  console.log(`\n[${label}]  POST /soul/v2/standard`);
  console.log(`  body: ${JSON.stringify(body)}`);
  const submit = await fetch(`${API}/higgsfield-ai/soul/v2/standard`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    const text = await submit.text();
    throw new Error(`[${label}] submit ${submit.status}: ${text.slice(0, 400)}`);
  }
  const queued = (await submit.json()) as { request_id: string };
  console.log(`  queued: ${queued.request_id}`);

  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await fetch(`${API}/requests/${queued.request_id}/status`, {
      headers: headers(env),
    });
    const data = (await r.json()) as {
      status: string;
      images?: Array<{ url?: string }>;
      message?: string;
    };
    process.stdout.write(`  status=${data.status}\n`);
    if (data.status === "completed") {
      const url = data.images?.[0]?.url;
      if (!url) throw new Error("completed but no image url");
      return url;
    }
    if (data.status === "failed" || data.status === "nsfw") {
      throw new Error(`[${label}] ${data.status}: ${data.message ?? "no detail"}`);
    }
  }
  throw new Error(`[${label}] timeout`);
}

async function listStyles(env: { key: string; secret: string }) {
  console.log("\n[Q2 — list Soul Style presets (v2)]");
  const r = await fetch(`${API}/v1/text2image/soul-styles/v2`, {
    headers: headers(env),
  });
  console.log(`  → ${r.status}`);
  if (!r.ok) {
    console.log(`  body: ${(await r.text()).slice(0, 400)}`);
    return;
  }
  const data = (await r.json()) as Array<{
    id: string;
    name: string;
    description?: string;
    preview_url?: string;
  }>;
  console.log(`  found ${data.length} v2 style presets:`);
  // Print first 15 to keep the output legible. The full catalog is ~33.
  for (const s of data.slice(0, 15)) {
    console.log(`   • ${s.name.padEnd(28)} (${s.id.slice(0, 8)}…)`);
  }
  if (data.length > 15) {
    console.log(`   ... and ${data.length - 15} more`);
  }
}

async function main() {
  const env = loadEnv();

  console.log("─── Q1: same seed + Soul ID, with vs without reference ───");
  console.log(`  prompt:    "${PROMPT}"`);
  console.log(`  soul_id:   ${SOUL_ID.slice(0, 8)}…`);
  console.log(`  seed:      ${SEED}`);
  console.log(`  reference: ${REFERENCE_URL.split("/").pop()}`);

  // Run BOTH in parallel — we have 2 of 4 concurrent slots free.
  const [withRef, withoutRef] = await Promise.all([
    generate(
      env,
      {
        prompt: PROMPT,
        custom_reference_id: SOUL_ID,
        aspect_ratio: "1:1",
        resolution: "720p",
        seed: SEED,
        image_url: REFERENCE_URL,
      },
      "A: WITH reference",
    ),
    generate(
      env,
      {
        prompt: PROMPT,
        custom_reference_id: SOUL_ID,
        aspect_ratio: "1:1",
        resolution: "720p",
        seed: SEED,
      },
      "B: WITHOUT reference",
    ),
  ]);

  console.log("\n─── Q1 results ───");
  console.log(`  A (with ref):    ${withRef}`);
  console.log(`  B (without ref): ${withoutRef}`);
  console.log(
    "\n  → Open both. If they look DIFFERENT (different pose / framing /",
  );
  console.log(
    "    lighting), the reference is honoured. If they look near-identical,",
  );
  console.log("    it's being silently dropped.");

  await listStyles(env);

  console.log("\n[probe-reference-vs-style] done");
}

main().catch((err) => {
  console.error("[probe-reference-vs-style] FAIL:", err.message ?? err);
  process.exit(1);
});
