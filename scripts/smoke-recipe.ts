/**
 * Live end-to-end smoke for the Soul Image Burst recipe.
 *
 * Drives Cookbook the EXACT same way the Slice 6 assistant DSL will:
 *   1. Use the asset-store API to import a Soul ID from your Higgsfield
 *      account into the in-memory library.
 *   2. Use the workflow-store API to addNode + addEdge a graph from
 *      scratch (Text + SoulID + HiggsfieldImageGen).
 *   3. Hand the graph to runWorkflow() with the real client wrappers
 *      (no mocks).
 *   4. Wait for completion and print every node's status + outputs.
 *
 * Costs: 1 Higgsfield credit (1 image at 720p, batchSize=1). Override
 * --batch=4 to spend 4 credits and get a grid back.
 *
 * Usage:
 *   npx tsx scripts/smoke-recipe.ts                # 1 image
 *   npx tsx scripts/smoke-recipe.ts --batch=4      # 4 images
 *   npx tsx scripts/smoke-recipe.ts --prompt="..."  # custom prompt
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load env BEFORE importing modules that read process.env on import.
function loadEnvFromFile() {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]!] = m[2]!;
  }
}
loadEnvFromFile();

// In a Node script (no browser, no localStorage), Zustand's persist
// middleware spams "storage unavailable" warnings on every set. Stub a
// noop localStorage so the run is quiet — same data, no actual persistence.
if (typeof globalThis.localStorage === "undefined") {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
    clear: () => {
      mem.clear();
    },
    get length() {
      return mem.size;
    },
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
  } as Storage;
}

// Static-site fetch wrapper — Cookbook's client wrappers POST to relative
// URLs (/api/higgsfield/image) which only work in the browser or when the
// Next dev server is up. For this script we want the wrapper to talk
// straight to platform.higgsfield.ai instead, so we shim fetch to rewrite
// the relative URL to the real one and wire auth headers.
const realFetch = globalThis.fetch.bind(globalThis);
const HF_KEY = process.env.HIGGSFIELD_API_KEY!;
const HF_SECRET = process.env.HIGGSFIELD_API_SECRET!;

globalThis.fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url = typeof input === "string" ? input : input.toString();

  // /api/higgsfield/image  →  POST /higgsfield-ai/soul/{variant}/...
  if (url.endsWith("/api/higgsfield/image") && init?.method === "POST") {
    const body = JSON.parse(init.body as string);
    const variant = body.variant as "v2" | "v1" | "cinema" | "none";
    const endpoint =
      variant === "v2" || variant === "none"
        ? "https://platform.higgsfield.ai/higgsfield-ai/soul/v2/standard"
        : variant === "cinema"
          ? "https://platform.higgsfield.ai/higgsfield-ai/soul/cinema"
          : "https://platform.higgsfield.ai/higgsfield-ai/soul/character";

    // Translate the body shape to what Higgsfield expects.
    const hfBody: Record<string, unknown> = {
      prompt: body.prompt,
      aspect_ratio: body.aspectRatio ?? "1:1",
      resolution: body.resolution ?? "720p",
      batch_size: body.batchSize ?? 1,
    };
    if (body.soulId) hfBody.custom_reference_id = body.soulId;
    if (body.mode === "reference" && body.referenceUrl) {
      hfBody.image_url = body.referenceUrl;
    }
    if (body.mode === "style" && body.styleId && variant !== "cinema") {
      hfBody.style_id = body.styleId;
    }
    if (typeof body.seed === "number") hfBody.seed = body.seed;
    if (body.negativePrompt) hfBody.negative_prompt = body.negativePrompt;

    return submitAndPoll(endpoint, hfBody, init.signal);
  }

  // /api/higgsfield/soul-ids  →  GET /v1/custom-references/list (+ per-char GET)
  if (url.endsWith("/api/higgsfield/soul-ids")) {
    return listSoulIdsRaw(init?.signal);
  }

  // Anything else: passthrough to the real fetch.
  return realFetch(input, init);
}) as typeof fetch;

function hfHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${HF_KEY}:${HF_SECRET}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function submitAndPoll(
  endpoint: string,
  body: Record<string, unknown>,
  signal?: AbortSignal | null,
): Promise<Response> {
  const submit = await realFetch(endpoint, {
    method: "POST",
    headers: hfHeaders(),
    body: JSON.stringify(body),
    signal: signal ?? undefined,
  });
  if (!submit.ok) {
    return submit; // surface to caller — handler will map error codes.
  }
  const queued = (await submit.json()) as { request_id: string };
  console.log(`  [hf] queued: ${queued.request_id}`);

  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return new Response(
        JSON.stringify({ error: "Aborted", code: "aborted" }),
        { status: 499, headers: { "Content-Type": "application/json" } },
      );
    }
    await new Promise((r) => setTimeout(r, 3000));
    const stat = await realFetch(
      `https://platform.higgsfield.ai/requests/${queued.request_id}/status`,
      { headers: hfHeaders() },
    );
    const data = (await stat.json()) as {
      status: string;
      images?: Array<{ url?: string }>;
      message?: string;
    };
    process.stdout.write(`  [hf] status=${data.status}\n`);
    if (data.status === "completed") {
      const urls = (data.images ?? [])
        .map((i) => i?.url)
        .filter((u): u is string => typeof u === "string");
      return new Response(
        JSON.stringify({
          imageUrls: urls,
          requestId: queued.request_id,
          model: endpoint.split("/").slice(-3).join("/").replace(/^\//, ""),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (data.status === "nsfw") {
      return new Response(
        JSON.stringify({ error: "NSFW", code: "nsfw" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    if (data.status === "failed") {
      return new Response(
        JSON.stringify({
          error: data.message ?? "failed",
          code: "upstream_failed",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
  }
  return new Response(
    JSON.stringify({ error: "Timeout", code: "timeout" }),
    { status: 502, headers: { "Content-Type": "application/json" } },
  );
}

interface RawListItem {
  id: string;
  name: string;
  model_version: "v2" | "v1" | "cinema";
  status: string;
  thumbnail_url: string | null;
  created_at: string;
  reference_media?: Array<{ media_url: string }>;
}

async function listSoulIdsRaw(
  signal?: AbortSignal | null,
): Promise<Response> {
  const r = await realFetch(
    "https://platform.higgsfield.ai/v1/custom-references/list?page=1&page_size=20",
    { headers: hfHeaders(), signal: signal ?? undefined },
  );
  if (!r.ok) {
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const data = (await r.json()) as { items: RawListItem[] };
  const items = await Promise.all(
    (data.items ?? []).map(async (it) => {
      let thumb: string | null = it.thumbnail_url;
      if (it.status === "completed" && !thumb) {
        try {
          const detail = await realFetch(
            `https://platform.higgsfield.ai/v1/custom-references/${it.id}`,
            { headers: hfHeaders() },
          );
          if (detail.ok) {
            const d = (await detail.json()) as RawListItem;
            thumb =
              d.thumbnail_url ?? d.reference_media?.[0]?.media_url ?? null;
          }
        } catch {
          /* ignore */
        }
      }
      return {
        id: it.id,
        name: it.name,
        modelVersion: it.model_version,
        status: it.status,
        thumbnailUrl: thumb,
        createdAt: it.created_at,
      };
    }),
  );
  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/* ─────── Now we can import the engine + stores; fetch is shimmed ─────── */

async function main() {
  const [
    { runWorkflow },
    { nodeRegistry },
    { useAssetStore },
    { useWorkflowStore },
    { fetchSoulIds },
  ] = await Promise.all([
    import("@/lib/engine/run-workflow"),
    import("@/lib/engine/registry"),
    import("@/lib/stores/asset-store"),
    import("@/lib/stores/workflow-store"),
    import("@/lib/higgsfield/call-higgsfield-image"),
  ]);
  // Side-effect import: registers every node schema.
  await import("@/lib/engine/all-nodes");
  const args = process.argv.slice(2);
  const batchArg = args.find((a) => a.startsWith("--batch="));
  const promptArg = args.find((a) => a.startsWith("--prompt="));
  const batchSize = (batchArg ? Number(batchArg.split("=")[1]) : 1) as
    | 1
    | 4;
  const prompt =
    promptArg?.split("=").slice(1).join("=") ??
    "an editorial portrait of a man, soft window light, neutral background, photoreal";

  console.log("[smoke-recipe] live recipe run");
  console.log(`  prompt: ${prompt}`);
  console.log(`  batch:  ${batchSize}`);

  // 1. Discover the user's Soul IDs (this is exactly what the Slice 6
  //    assistant will do when "find me a Soul ID" is part of the
  //    intent). Pick the first completed v2 character.
  console.log("\n[step 1] listing trained Soul IDs…");
  const ids = await fetchSoulIds(new AbortController().signal);
  const v2 = ids.find((i) => i.modelVersion === "v2" && i.status === "completed");
  if (!v2) {
    console.error("  no completed v2 Soul ID found in your account.");
    process.exit(1);
  }
  console.log(`  picked: ${v2.name} (${v2.id.slice(0, 8)}…)`);

  // 2. Import it as a library asset.
  const soulAssetId = useAssetStore.getState().importSoulIdAsset({
    customReferenceId: v2.id,
    variant: v2.modelVersion,
    name: v2.name,
    thumbnailUrl: v2.thumbnailUrl,
  });
  console.log(`  imported as asset ${soulAssetId}`);

  // 3. Build the workflow from scratch.
  console.log("\n[step 2] building workflow Text + SoulID → HiggsfieldImageGen…");
  const store = useWorkflowStore.getState();
  const promptId = store.addNode("text", { x: 0, y: 0 }, { text: prompt });
  const soulId = store.addNode(
    "soul-id",
    { x: 0, y: 200 },
    { assetId: soulAssetId },
  );
  const genId = store.addNode("higgsfield-image-gen", { x: 300, y: 100 }, {
    batchSize,
    aspectRatio: "1:1",
    resolution: "720p",
  });
  store.addEdge({
    source: promptId,
    sourceHandle: "out",
    target: genId,
    targetHandle: "prompt",
  });
  store.addEdge({
    source: soulId,
    sourceHandle: "out",
    target: genId,
    targetHandle: "soulId",
  });
  console.log(
    `  ${useWorkflowStore.getState().nodes.length} nodes, ${useWorkflowStore.getState().edges.length} edges`,
  );

  // 4. Run.
  console.log("\n[step 3] running workflow…");
  const t0 = Date.now();
  const { nodes, edges } = useWorkflowStore.getState();
  const result = await runWorkflow({
    nodes,
    edges,
    registry: nodeRegistry,
    cache: new Map(),
    signal: new AbortController().signal,
    onProgress: (id, r) => {
      const node = nodes.find((n) => n.id === id);
      const label = node ? `${node.kind}` : id;
      console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${label} → ${r.status}`);
    },
  });
  console.log(`\n[smoke-recipe] result: ok=${result.ok}`);
  if (!result.ok && result.failedNodeId) {
    const failedKind = nodes.find((n) => n.id === result.failedNodeId)?.kind;
    console.log(`  failed at node: ${failedKind ?? result.failedNodeId}`);
  }

  // 5. Print the gen node's outputs.
  const genRecord = result.records.get(genId);
  if (genRecord?.status === "done") {
    const out = genRecord.output;
    if (Array.isArray(out)) {
      console.log(`\n[smoke-recipe] gen output (${out.length} image(s)):`);
      for (const o of out) {
        if (o.type === "image") console.log(`  • ${o.value.url}`);
      }
    }
  } else if (genRecord?.status === "error") {
    console.log(`\n[smoke-recipe] gen error: ${genRecord.error}`);
  }
}

main().catch((err) => {
  console.error("[smoke-recipe] FAIL:", err);
  process.exit(1);
});
