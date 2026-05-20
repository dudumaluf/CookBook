/**
 * Quick poll-watcher: submits a single cheap request and prints
 * timestamped status transitions until completion / failure / cap.
 *
 * Cheaper than ab-test: resolution:720p (not quality:2k), no Soul ID,
 * landscape prompt — just the cheapest possible Soul 2 generation we
 * can submit to verify the queue is actually moving.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const API_BASE = "https://platform.higgsfield.ai";

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
  // Per the official Higgsfield API docs (cloud.higgsfield.ai/models, May 2026):
  // `Authorization: Key {key}:{secret}` is the canonical auth header.
  // Prism's "hf-api-key" + "hf-secret" pair is from an older API version
  // and may be silently accepted by submit but cause queue-stalls or
  // pipeline-mismatch on processing.
  return {
    Authorization: `Key ${env.key}:${env.secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function main() {
  const env = loadEnv();
  const t0 = Date.now();
  const tag = (label: string) =>
    `[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`;

  const SOUL_ID = "b66a1caa-612f-440d-8353-debceb00aae6"; // Dudu Model
  console.log(tag("submitting Soul 2 request with Dudu Model + Authorization: Key auth"));
  const submit = await fetch(`${API_BASE}/higgsfield-ai/soul/v2/standard`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      prompt:
        "an editorial portrait of a man, soft window light, neutral background, photoreal, head and shoulders fully in frame",
      custom_reference_id: SOUL_ID,
      aspect_ratio: "1:1",
      resolution: "720p",
    }),
  });
  const submitText = await submit.text();
  console.log(tag(`submit → ${submit.status}`));
  if (!submit.ok) {
    console.log(tag(`body: ${submitText.slice(0, 500)}`));
    process.exit(1);
  }
  const queued = JSON.parse(submitText) as { request_id: string };
  console.log(tag(`queued: ${queued.request_id}`));

  let lastStatus = "";
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const stat = await fetch(
      `${API_BASE}/requests/${queued.request_id}/status`,
      { headers: headers(env) },
    );
    const data = (await stat.json()) as {
      status: string;
      images?: Array<{ url?: string }>;
      message?: string;
    };
    if (data.status !== lastStatus) {
      console.log(tag(`status=${data.status}`));
      lastStatus = data.status;
    }
    if (data.status === "completed") {
      console.log(tag(`DONE: ${data.images?.[0]?.url ?? "(no url)"}`));
      return;
    }
    if (data.status === "failed" || data.status === "nsfw") {
      console.log(tag(`terminal: ${data.status} msg=${data.message ?? "—"}`));
      return;
    }
  }
  console.log(tag("CAP REACHED — still queued/in_progress after 120s"));
  console.log(
    tag(
      `to cancel manually: curl -X POST -H "hf-api-key: ${env.key.slice(0, 8)}..." -H "hf-secret: ${env.secret.slice(0, 4)}..." ${API_BASE}/requests/${queued.request_id}/cancel`,
    ),
  );
}

main().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
