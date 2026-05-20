/**
 * Test the dedicated Soul Reference endpoint (/soul/reference) with the
 * same Soul ID + Matthew McConaughey reference. If THIS endpoint honours
 * the reference, we know /soul/v2/standard simply doesn't support
 * reference mode (and the route should switch endpoints when an image
 * input is wired).
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
): Promise<string> {
  console.log(`\n[${label}]  POST ${endpoint}`);
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
    throw new Error(`[${label}] ${submit.status}: ${text.slice(0, 400)}`);
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
    process.stdout.write(`  status=${data.status}\n`);
    if (data.status === "completed") {
      const url = data.images?.[0]?.url;
      if (!url) throw new Error("completed but no url");
      return url;
    }
    if (data.status === "failed" || data.status === "nsfw") {
      throw new Error(`[${label}] ${data.status}: ${data.message ?? "no detail"}`);
    }
  }
  throw new Error(`[${label}] timeout`);
}

async function main() {
  const env = loadEnv();
  console.log("Same Soul ID + Same reference image, but /soul/reference (v1)");
  console.log(`  prompt:    "a man"`);
  console.log(`  soul_id:   ${SOUL_ID.slice(0, 8)}…`);
  console.log(`  reference: McConaughey jacket photo`);

  const url = await generate(
    env,
    "/higgsfield-ai/soul/reference",
    {
      prompt: "a man",
      custom_reference_id: SOUL_ID,
      image_url: REF,
      aspect_ratio: "1:1",
      resolution: "720p",
    },
    "/soul/reference + custom_reference_id + image_url",
  );

  console.log(`\nRESULT: ${url}`);
  console.log(
    "\n→ Open it. If you see McConaughey-styled features (long hair, leather",
  );
  console.log(
    "  jacket vibes, brown tones), the v1 reference endpoint honours the ref.",
  );
  console.log(
    "  Then we know our route should send reference traffic here, not v2/standard.",
  );
}

main().catch((e) => {
  console.error("FAIL:", e.message ?? e);
  process.exit(1);
});
