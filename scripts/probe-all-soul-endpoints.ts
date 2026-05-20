/**
 * Probe every plausible Soul-related endpoint with a body that includes
 * BOTH custom_reference_id and image_url, cancel before processing,
 * and report which ones accept the body without 422-ing.
 *
 * Goal: find the right endpoint for "Soul ID + reference image" mode.
 * /soul/v2/standard accepts the body with 200 but the reference seems
 * to be ignored. Maybe there's a /soul/v2/reference or similar.
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

function authHeaders(env: { key: string; secret: string }) {
  return {
    Authorization: `Key ${env.key}:${env.secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

const API = "https://platform.higgsfield.ai";

const ENDPOINTS = [
  // v2 family
  "/higgsfield-ai/soul/v2/standard",
  "/higgsfield-ai/soul/v2/character",
  "/higgsfield-ai/soul/v2/reference",
  "/higgsfield-ai/soul/v2",
  "/higgsfield-ai/soul-v2/standard",
  "/higgsfield-ai/soul-v2/reference",
  // legacy v1
  "/higgsfield-ai/soul/standard",
  "/higgsfield-ai/soul/reference",
  "/higgsfield-ai/soul/character",
  // cinema
  "/higgsfield-ai/soul/cinema",
  "/higgsfield-ai/soul-cinematic",
  "/higgsfield-ai/soul/cinematic",
  // image-to-image (a hint from the WaveSpeedAI doc earlier)
  "/higgsfield-ai/soul/i2i",
  "/higgsfield-ai/soul/v2/i2i",
  "/higgsfield-ai/soul/image-to-image",
  "/higgsfield-ai/soul/v2/image-to-image",
  // edit / re-render
  "/higgsfield-ai/soul/edit",
  "/higgsfield-ai/soul/v2/edit",
  // nano banana (different model entirely, but maybe handles reference better)
  "/higgsfield-ai/nano_banana_2",
];

async function probe(
  env: { key: string; secret: string },
  path: string,
  body: Record<string, unknown>,
) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  // If queued, cancel immediately (free)
  if (parsed && typeof parsed === "object" && "request_id" in parsed) {
    const rid = (parsed as { request_id: string }).request_id;
    await fetch(`${API}/requests/${rid}/cancel`, {
      method: "POST",
      headers: authHeaders(env),
    });
  }
  // Print just status + first 200 chars
  const oneLine = text.replace(/\s+/g, " ").slice(0, 220);
  console.log(`  ${r.status.toString().padStart(3)}  ${path.padEnd(45)} ${oneLine}`);
}

async function main() {
  const env = loadEnv();
  const SOUL_ID = "b66a1caa-612f-440d-8353-debceb00aae6";
  const REF =
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Matthew_McConaughey_2019_by_Glenn_Francis.jpg/640px-Matthew_McConaughey_2019_by_Glenn_Francis.jpg";

  console.log("─── Body: prompt + soul_id + image_url + aspect_ratio + resolution ───");
  for (const path of ENDPOINTS) {
    await probe(env, path, {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      image_url: REF,
      aspect_ratio: "1:1",
      resolution: "720p",
    });
  }

  console.log("\n─── Body: prompt + soul_id + reference_image (alt field name) ───");
  for (const path of ENDPOINTS.slice(0, 8)) {
    await probe(env, path, {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      reference_image: REF,
      aspect_ratio: "1:1",
      resolution: "720p",
    });
  }

  console.log("\n─── Body: prompt + soul_id + input_image (alt field name) ───");
  for (const path of ENDPOINTS.slice(0, 8)) {
    await probe(env, path, {
      prompt: "test",
      custom_reference_id: SOUL_ID,
      input_image: REF,
      aspect_ratio: "1:1",
      resolution: "720p",
    });
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
