/**
 * One-shot smoke test: upload a tiny synthetic PNG to the cookbook-assets
 * bucket and verify the public URL serves it back. Confirms the bucket +
 * RLS policies match what the browser client will see at runtime.
 *
 * Talks straight to the Storage REST API (instead of supabase-js) to dodge
 * the Realtime client's WebSocket-on-Node bootstrap requirement. The same
 * URLs and bearer token shape are what supabase-js issues from the browser.
 *
 * Usage:
 *   npx tsx scripts/smoke-upload.ts          # uploads + leaves the object
 *   npx tsx scripts/smoke-upload.ts --clean  # uploads + deletes
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(): { url: string; key: string; bucket: string } {
  const dotenv = resolve(process.cwd(), ".env.local");
  const text = readFileSync(dotenv, "utf-8");
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!;
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const bucket = env.NEXT_PUBLIC_SUPABASE_ASSETS_BUCKET ?? "cookbook-assets";
  if (!url || !key) throw new Error("missing supabase env in .env.local");
  return { url, key, bucket };
}

// Smallest valid 1x1 PNG: 67 bytes, transparent pixel.
const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

async function main() {
  const { url, key, bucket } = loadEnv();
  const objectKey = `images/smoke${Date.now().toString(36)}/pixel.png`;
  const objectUrl = `${url}/storage/v1/object/${bucket}/${objectKey}`;
  const publicUrl = `${url}/storage/v1/object/public/${bucket}/${objectKey}`;
  console.log("uploading →", `${bucket}/${objectKey}`);

  const upRes = await fetch(objectUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "image/png",
      "x-upsert": "false",
    },
    body: PNG_1X1,
  });
  if (!upRes.ok) {
    console.error("upload failed:", upRes.status, await upRes.text());
    process.exit(1);
  }
  console.log("upload status:", upRes.status);
  console.log("public URL:", publicUrl);

  const headRes = await fetch(publicUrl, { method: "HEAD" });
  console.log(
    "HEAD status:",
    headRes.status,
    headRes.headers.get("content-type"),
  );

  if (process.argv.includes("--clean")) {
    const rmRes = await fetch(objectUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    });
    console.log(
      "cleanup:",
      rmRes.ok ? "ok" : `${rmRes.status} ${await rmRes.text()}`,
    );
  } else {
    console.log("(kept the test object; pass --clean to remove)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
