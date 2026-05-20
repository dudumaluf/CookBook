/**
 * Cancel any stuck/queued requests so we get our concurrency slot back.
 *
 * The Higgsfield API caps concurrent requests at 4 per keypair. The
 * earlier A/B test timeouts left jobs queued without our process being
 * able to cancel them (the timeout returned before cancellation ran).
 * This script targets the request_ids we know about from this session
 * and cancels them.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const API_BASE = "https://platform.higgsfield.ai";

const STUCK_REQUEST_IDS = [
  // From the second A/B test (this evening)
  "00e9b8d3-a4f4-43cb-b8d0-9448e873ee5d", // B: /soul/character
  "072a7186-0d28-4320-bdb8-059a70821a14", // A: /soul/v2/standard
  // From the first A/B test (slightly earlier)
  "5274c7a6-ca5d-4e0a-b66b-f19048fb6ce5",
  "3a45c4a4-05ff-43a3-a197-2771f565db3f",
  "5fe7300d-dbf4-4372-8164-44f28f3f7e02",
  "7329f133-94b6-4877-b4c6-ba96df7012cb",
  "113e2905-c194-4e81-99e9-751bf39473a0",
  "91a74ff8-2033-4649-8308-87711ba5512f",
  "0ce8511e-8fa0-47a7-b3c0-154bcdf5114c",
  "eb37a427-ad57-4ee5-925c-d1520aaecca9",
];

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

async function main() {
  const env = loadEnv();
  // Use BOTH auth shapes since some jobs were submitted under each.
  const authShapes: Array<Record<string, string>> = [
    {
      Authorization: `Key ${env.key}:${env.secret}`,
      Accept: "application/json",
    },
    {
      "hf-api-key": env.key,
      "hf-secret": env.secret,
      Accept: "application/json",
    },
  ];

  for (const rid of STUCK_REQUEST_IDS) {
    let cancelled = false;
    for (const headers of authShapes) {
      const stat = await fetch(`${API_BASE}/requests/${rid}/status`, {
        headers,
      });
      if (!stat.ok) continue;
      const data = (await stat.json()) as { status: string };
      console.log(`${rid}  status=${data.status}`);
      if (data.status === "queued") {
        const cancel = await fetch(`${API_BASE}/requests/${rid}/cancel`, {
          method: "POST",
          headers,
        });
        console.log(`  → cancel: ${cancel.status}`);
        cancelled = true;
        break;
      } else {
        // Already terminal (completed/failed/in_progress not cancellable)
        cancelled = true;
        break;
      }
    }
    if (!cancelled) {
      console.log(`${rid}  (could not reach status with either auth)`);
    }
  }
}

main().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
