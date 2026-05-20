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
  return {
    Authorization: `Key ${key}:${secret}`,
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

async function generateOne(env: Env, soulId?: string): Promise<string> {
  const body: Record<string, unknown> = {
    prompt:
      "an editorial portrait, soft window light, neutral background, photoreal",
    aspect_ratio: "1:1",
    resolution: "720p",
    batch_size: 1,
  };
  if (soulId) body.custom_reference_id = soulId;

  const submit = await fetch(`${API_BASE}/higgsfield-ai/soul/v2/standard`, {
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
  console.log(`  queued: request_id=${queued.request_id}`);

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
    process.stdout.write(`  status=${status.status}\n`);
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

  if (process.argv.includes("--generate")) {
    console.log("\n→ generating one image…");
    const completedSoulIds = ids.filter(
      (i) => i.status === "completed" && i.model_version === "v2",
    );
    const pickSoulId = completedSoulIds[0]?.id;
    if (pickSoulId) {
      console.log(`  using Soul ID: ${pickSoulId.slice(0, 8)}…`);
    } else {
      console.log("  no completed v2 Soul IDs — generating without one");
    }
    const url = await generateOne(env, pickSoulId);
    console.log(`\n[smoke-higgsfield] OK: ${url}`);
  } else {
    console.log("\n[smoke-higgsfield] OK (list-only — pass --generate to also test generation)");
  }
}

main().catch((err) => {
  console.error("[smoke-higgsfield] FAIL:", err.message ?? err);
  process.exit(1);
});
