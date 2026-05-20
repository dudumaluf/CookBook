/**
 * One-shot smoke test against the live Higgsfield Cloud API.
 *
 * 1. Loads HIGGSFIELD_API_KEY + HIGGSFIELD_API_SECRET from .env.local.
 * 2. Lists Soul ID characters trained under the keypair.
 * 3. (Optional) Submits a tiny generation against soul/v2/standard and waits
 *    for it to complete, printing the resulting image URL.
 *
 * Usage:
 *   npx tsx scripts/smoke-higgsfield.ts            # list-only (cheap)
 *   npx tsx scripts/smoke-higgsfield.ts --generate # also generate one image
 *
 * This bypasses our Next.js route and talks directly to platform.higgsfield.ai
 * so we can verify the contract before the route + node UI even loads. Same
 * auth header + endpoint shape the server wrapper uses.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const API_BASE = "https://platform.higgsfield.ai";

interface Env {
  key: string;
  secret: string;
}

function loadEnv(): Env {
  const dotenv = resolve(process.cwd(), ".env.local");
  const text = readFileSync(dotenv, "utf-8");
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!;
  }
  const key = env.HIGGSFIELD_API_KEY;
  const secret = env.HIGGSFIELD_API_SECRET;
  if (!key || !secret) {
    throw new Error(
      "Missing HIGGSFIELD_API_KEY / HIGGSFIELD_API_SECRET in .env.local",
    );
  }
  return { key, secret };
}

function authHeaders({ key, secret }: Env): Record<string, string> {
  // The current Higgsfield docs (May 2026) say `Authorization: Key K:S`,
  // but Prism's empirically-validated production code uses separate
  // `hf-api-key` + `hf-secret` headers. The combined Authorization form
  // *passes auth* (requests succeed) but the Soul ID `custom_reference_id`
  // is silently dropped — the model renders without any character lock.
  // See investigation note in ADR-0029 (Slice 4.5).
  return {
    "hf-api-key": key,
    "hf-secret": secret,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

interface RawCustomReference {
  id: string;
  name: string;
  model_version: "v1" | "v2" | "cinema";
  status: string;
  thumbnail_url: string | null;
  created_at: string;
}

interface ListResponse {
  total: number;
  page: number;
  total_pages: number;
  items: RawCustomReference[];
}

async function listSoulIds(env: Env): Promise<RawCustomReference[]> {
  const all: RawCustomReference[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(
      `${API_BASE}/v1/custom-references/list?page=${page}&page_size=20`,
      { headers: authHeaders(env) },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `list-soul-ids failed ${res.status}: ${text.slice(0, 500)}`,
      );
    }
    const data = JSON.parse(text) as ListResponse;
    all.push(...(data.items ?? []));
    if (!data.total_pages || page >= data.total_pages) break;
  }
  return all;
}

interface QueueResponse {
  status: "queued";
  request_id: string;
}

interface StatusResponse {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw";
  request_id: string;
  images?: Array<{ url?: string }>;
  message?: string;
}

interface GenerateOptions {
  aspectRatio: "1:1" | "9:16" | "16:9" | "4:3" | "3:4" | "3:2" | "2:3";
  prompt?: string;
}

async function generateOne(
  env: Env,
  soulId: string | undefined,
  opts: GenerateOptions,
): Promise<string> {
  const body: Record<string, unknown> = {
    prompt:
      opts.prompt ??
      // Note: explicit "full body, head not cropped, head fully in frame"
      // — the previous run came back as a tight torso crop because the
      // generic "portrait" prompt was being interpreted as upper-body.
      "an editorial full-body portrait, head and shoulders fully in frame, soft window light, neutral background, photoreal",
    aspect_ratio: opts.aspectRatio,
    resolution: "720p",
    batch_size: 1,
  };
  if (soulId) body.custom_reference_id = soulId;

  // Soul ID-aware endpoint. The v2/standard endpoint silently DROPS
  // custom_reference_id and renders a generic person — verified empirically
  // (see scripts/probe-character-endpoint.ts). The /soul/character endpoint
  // honours it. Prism's documentation said v2 only had "standard" mode but
  // Higgsfield seems to have re-added character/reference modes since.
  const endpoint = soulId
    ? `${API_BASE}/higgsfield-ai/soul/character`
    : `${API_BASE}/higgsfield-ai/soul/v2/standard`;
  const submit = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify(body),
  });
  const submitText = await submit.text();
  if (!submit.ok) {
    throw new Error(
      `submit failed ${submit.status}: ${submitText.slice(0, 800)}`,
    );
  }
  const queued = JSON.parse(submitText) as QueueResponse;
  const tag = `[${opts.aspectRatio}]`;
  console.log(`  ${tag} queued: request_id=${queued.request_id}`);

  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000));
    const poll = await fetch(
      `${API_BASE}/requests/${queued.request_id}/status`,
      { headers: authHeaders(env) },
    );
    const pollText = await poll.text();
    if (!poll.ok) {
      throw new Error(
        `poll failed ${poll.status}: ${pollText.slice(0, 800)}`,
      );
    }
    const status = JSON.parse(pollText) as StatusResponse;
    process.stdout.write(`  ${tag} status=${status.status}\n`);
    if (status.status === "completed") {
      const url = status.images?.[0]?.url;
      if (!url) throw new Error("completed but no image url");
      return url;
    }
    if (status.status === "nsfw") throw new Error("rejected as NSFW");
    if (status.status === "failed") {
      throw new Error(`generation failed: ${status.message ?? "no detail"}`);
    }
  }
  throw new Error("timeout waiting for completion");
}

async function main() {
  const env = loadEnv();
  console.log("[smoke-higgsfield] using key", env.key.slice(0, 8) + "…");

  console.log("\n→ listing Soul IDs…");
  const ids = await listSoulIds(env);
  console.log(`  found ${ids.length} character(s):`);
  for (const id of ids) {
    console.log(
      `   • ${id.name} [${id.model_version}, ${id.status}] (${id.id})`,
    );
  }

  // Aspect ratios to render: defaults to all three primaries. Override
  // with `--ratios=1:1,9:16` etc. for a subset.
  const ratiosArg = process.argv
    .find((a) => a.startsWith("--ratios="))
    ?.split("=")[1];
  const wantsGenerate =
    process.argv.includes("--generate") ||
    process.argv.some((a) => a.startsWith("--ratios="));

  if (!wantsGenerate) {
    console.log(
      "\n[smoke-higgsfield] OK (list-only — pass --generate or --ratios=… to also test generation)",
    );
    return;
  }

  type AR = GenerateOptions["aspectRatio"];
  const ratios: AR[] = ratiosArg
    ? (ratiosArg.split(",").map((s) => s.trim()) as AR[])
    : ["1:1", "9:16", "16:9"];

  const completedSoulIds = ids.filter(
    (i) => i.status === "completed" && i.model_version === "v2",
  );
  const pickSoulId = completedSoulIds[0]?.id;
  if (pickSoulId) {
    console.log(`\n→ generating ${ratios.length} image(s) using Soul ID ${pickSoulId.slice(0, 8)}…`);
  } else {
    console.log(
      `\n→ generating ${ratios.length} image(s) without a Soul ID (no completed v2 character)`,
    );
  }

  // Run all aspect ratios in parallel — the queue accepts concurrent
  // submissions and total wallclock drops to the slowest single render.
  const results = await Promise.allSettled(
    ratios.map(async (ar) => {
      console.log(`  [${ar}] submitting…`);
      const url = await generateOne(env, pickSoulId, { aspectRatio: ar });
      console.log(`  [${ar}] DONE: ${url}`);
      return { ar, url };
    }),
  );

  console.log("\n[smoke-higgsfield] summary:");
  for (const r of results) {
    if (r.status === "fulfilled") {
      console.log(`  ✓ ${r.value.ar}  →  ${r.value.url}`);
    } else {
      console.log(`  ✗ FAIL: ${r.reason?.message ?? r.reason}`);
    }
  }
}

main().catch((err) => {
  console.error("[smoke-higgsfield] FAIL:", err.message ?? err);
  process.exit(1);
});
