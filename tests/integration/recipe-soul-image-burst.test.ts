import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWorkflow, type ExecutionCache } from "@/lib/engine/run-workflow";
import { nodeRegistry } from "@/lib/engine/registry";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { ExecutionRecord, StandardizedOutput } from "@/types/node";

/**
 * Integration tests for the "Soul Image Burst" recipe — proves end-to-end
 * that an LLM (or any non-UI caller) can:
 *
 *   1. Build a workflow purely via the asset-store + workflow-store APIs.
 *   2. Hand it to `runWorkflow()` and get a sensible result back.
 *   3. Read the structured outputs (image URLs) from the per-node records.
 *
 * This is the API surface the Slice 6 assistant DSL will call. We mock
 * the network here so CI can run it; `scripts/smoke-recipe.ts` is the
 * companion script that runs the same path against the live Higgsfield.
 *
 * IMPORTANT: this test imports `@/lib/engine/all-nodes` so the registry
 * is populated. Without that side-effect, `addNode("soul-id")` etc would
 * fail because the schema isn't registered yet.
 */

// Register every node schema by importing all-nodes (side effect).
await import("@/lib/engine/all-nodes");

vi.mock("@/lib/higgsfield/call-higgsfield-image", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/higgsfield/call-higgsfield-image")
  >("@/lib/higgsfield/call-higgsfield-image");
  return {
    ...actual,
    callHiggsfieldImage: vi.fn(),
  };
});

vi.mock("@/lib/llm/call-openrouter", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/llm/call-openrouter")
  >("@/lib/llm/call-openrouter");
  return {
    ...actual,
    callOpenRouter: vi.fn(),
  };
});

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  uploadImageFromUrl: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

const higgs = await import("@/lib/higgsfield/call-higgsfield-image");
const callMock = vi.mocked(higgs.callHiggsfieldImage);
const llm = await import("@/lib/llm/call-openrouter");
const llmMock = vi.mocked(llm.callOpenRouter);
const upload = await import("@/lib/library/upload-asset");
const uploadFromUrlMock = vi.mocked(upload.uploadImageFromUrl);

beforeEach(() => {
  useWorkflowStore.getState().clear();
  useAssetStore.getState().clear();
  callMock.mockReset();
  llmMock.mockReset();
  uploadFromUrlMock.mockReset();
  uploadFromUrlMock.mockImplementation(async (url) => ({
    bucket: "cookbook-assets",
    key: `images/x/${url.split("/").pop() ?? "result.png"}`,
    url: `https://cdn.supabase.test/cookbook-assets/images/x/result.png`,
    mime: "image/png",
    sizeBytes: 1234,
  }));
});

afterEach(() => {
  useWorkflowStore.getState().clear();
  useAssetStore.getState().clear();
});

/**
 * Helper that walks an array of records to its terminal state, polling
 * the in-progress promise. We don't have async iteration on the engine —
 * runWorkflow is itself a promise that resolves when the run is done.
 */
async function runFromStore() {
  const cache: ExecutionCache = new Map();
  const records = new Map<string, ExecutionRecord>();
  const { nodes, edges } = useWorkflowStore.getState();
  const result = await runWorkflow({
    nodes,
    edges,
    registry: nodeRegistry,
    cache,
    signal: new AbortController().signal,
    onProgress: (id, r) => records.set(id, r),
  });
  return { result, records };
}

/* ────────────────────────────────────────────────────────────────────── */
/* Recipe 1 — minimal: Text → LLM Text                                    */
/* ────────────────────────────────────────────────────────────────────── */

describe("LLM-callable recipe path — minimal Text → LLM Text", () => {
  it("can be built with addNode/addEdge and runs to a 'done' record", async () => {
    llmMock.mockResolvedValueOnce({
      text: "two haikus, here you go.",
      model: "anthropic/claude-sonnet-4.5",
      costUsd: 0.0001,
      inputTokens: 12,
      outputTokens: 24,
    });

    const store = useWorkflowStore.getState();
    const promptId = store.addNode(
      "text",
      { x: 0, y: 0 },
      { text: "Write me two haikus about coffee." },
    );
    const llmId = store.addNode(
      "llm-text",
      { x: 200, y: 0 },
      { model: "anthropic/claude-sonnet-4.5" },
    );
    store.addEdge({
      source: promptId,
      sourceHandle: "out",
      target: llmId,
      targetHandle: "user",
    });

    const { result, records } = await runFromStore();

    expect(result.ok).toBe(true);
    expect(records.get(llmId)?.status).toBe("done");
    const out = records.get(llmId)?.output as StandardizedOutput;
    expect(out.type).toBe("text");
    expect((out as { value: string }).value).toMatch(/haikus/i);

    // The LLM was called with the upstream Text node's content.
    expect(llmMock).toHaveBeenCalledTimes(1);
    expect(llmMock.mock.calls[0]![0].user).toMatch(/coffee/);
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* Recipe 2 — full Soul Image Burst (mocked)                              */
/* ────────────────────────────────────────────────────────────────────── */

describe("LLM-callable recipe path — Soul Image Burst (mocked)", () => {
  it("Text + SoulID + HiggsfieldImageGen builds, runs, returns image outputs", async () => {
    callMock.mockResolvedValueOnce({
      imageUrls: [
        "https://cdn.example/burst-1.png",
        "https://cdn.example/burst-2.png",
        "https://cdn.example/burst-3.png",
        "https://cdn.example/burst-4.png",
      ],
      requestId: "req-burst",
      model: "higgsfield-ai/soul/v2/standard",
    });

    // 1. Import a Soul ID into the library (the LLM would do this via
    //    `useAssetStore.getState().importSoulIdAsset(...)` after fetching
    //    the list from /api/higgsfield/soul-ids).
    const soulAssetId = useAssetStore.getState().importSoulIdAsset({
      customReferenceId: "b66a1caa-612f-440d-8353-debceb00aae6",
      variant: "v2",
      name: "Test Soul",
      thumbnailUrl: null,
    });

    // 2. Build the workflow: Text(prompt) → HiggsfieldImageGen.prompt
    //                       SoulID(asset) → HiggsfieldImageGen.soulId
    const store = useWorkflowStore.getState();
    const promptId = store.addNode(
      "text",
      { x: 0, y: 0 },
      { text: "editorial portrait, soft window light, neutral background" },
    );
    const soulId = store.addNode(
      "soul-id",
      { x: 0, y: 200 },
      { assetId: soulAssetId },
    );
    const genId = store.addNode(
      "higgsfield-image-gen",
      { x: 300, y: 100 },
      { batchSize: 4, aspectRatio: "1:1", resolution: "720p" },
    );
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

    // 3. Run.
    const { result, records } = await runFromStore();
    expect(result.ok).toBe(true);

    // 4. Validate the gen node ran with the expected request shape.
    expect(callMock).toHaveBeenCalledTimes(1);
    const callArgs = callMock.mock.calls[0]![0];
    expect(callArgs.prompt).toMatch(/editorial portrait/);
    expect(callArgs.variant).toBe("v2");
    expect(callArgs.soulId).toBe("b66a1caa-612f-440d-8353-debceb00aae6");
    expect(callArgs.batchSize).toBe(4);
    expect(callArgs.aspectRatio).toBe("1:1");

    // 5. Validate the gen node's output is the array of 4 image refs.
    const genRecord = records.get(genId)!;
    expect(genRecord.status).toBe("done");
    const out = genRecord.output as StandardizedOutput[];
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({
      type: "image",
      value: { url: "https://cdn.example/burst-1.png" },
    });
    expect(genRecord.usage?.model).toBe("higgsfield-ai/soul/v2/standard");
  });

  it("with an ImageIterator wired, HiggsfieldImageGen runs ONCE PER reference image", async () => {
    // Iterator fan-out: 3 references → 3 separate calls, each with a
    // different referenceUrl. The engine picks up the iterator flag and
    // dispatches the downstream node 3 times in parallel.
    callMock.mockImplementation(async (args) => ({
      imageUrls: [`https://cdn.example/result-for-${args.referenceUrl?.slice(-5)}`],
      requestId: `req-${args.referenceUrl?.slice(-5)}`,
      model: "higgsfield-ai/soul/v2/standard",
    }));

    const soulAssetId = useAssetStore.getState().importSoulIdAsset({
      customReferenceId: "b66a1caa-612f-440d-8353-debceb00aae6",
      variant: "v2",
      name: "Test Soul",
      thumbnailUrl: null,
    });
    const ref1 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/aa1.jpg" });
    const ref2 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/bb2.jpg" });
    const ref3 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/cc3.jpg" });

    // Slice 5.6 (ADR-0032): Image Iterator is always linked to an
    // AssetGroup in the library. Create the group first, then the
    // iterator references it via `groupId`.
    const groupId = useAssetStore.getState().createGroup({
      name: "Test references",
      assetIds: [ref1, ref2, ref3],
      isUntitled: false,
    });
    const store = useWorkflowStore.getState();
    const promptId = store.addNode("text", { x: 0, y: 0 }, { text: "go" });
    const soulId = store.addNode("soul-id", { x: 0, y: 200 }, {
      assetId: soulAssetId,
    });
    const iterId = store.addNode("image-iterator", { x: 200, y: 500 }, {
      groupId,
      cursor: 0,
      selectionMode: "all",
    });
    const genId = store.addNode("higgsfield-image-gen", { x: 400, y: 100 }, {});

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
    store.addEdge({
      source: iterId,
      sourceHandle: "out",
      target: genId,
      targetHandle: "image",
    });

    const { result, records } = await runFromStore();
    expect(result.ok).toBe(true);

    // Three separate generator invocations, each in reference mode.
    expect(callMock).toHaveBeenCalledTimes(3);
    const seenRefs = callMock.mock.calls
      .map((c) => c[0].referenceUrl)
      .sort();
    expect(seenRefs).toEqual([
      "https://example.com/aa1.jpg",
      "https://example.com/bb2.jpg",
      "https://example.com/cc3.jpg",
    ]);
    for (const c of callMock.mock.calls) {
      expect(c[0].mode).toBe("reference");
    }

    // The aggregated output is the array of 3 result images.
    const genRecord = records.get(genId)!;
    expect(genRecord.status).toBe("done");
    const out = genRecord.output as StandardizedOutput[];
    expect(out).toHaveLength(3);
    // Fan-out progress reached 3/3 by the end.
    expect(genRecord.fanOut).toEqual({ total: 3, done: 3 });
  });

  it("with an Image input wired switches to mode='reference'", async () => {
    callMock.mockResolvedValueOnce({
      imageUrls: ["https://cdn.example/ref-result.png"],
      requestId: "req-ref",
      model: "higgsfield-ai/soul/v2/standard",
    });

    const soulAssetId = useAssetStore.getState().importSoulIdAsset({
      customReferenceId: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
      variant: "v2",
      name: "Test",
      thumbnailUrl: null,
    });
    const imageAssetId = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/ref.jpg" });

    const store = useWorkflowStore.getState();
    const promptId = store.addNode("text", { x: 0, y: 0 }, { text: "test" });
    const soulId = store.addNode("soul-id", { x: 0, y: 200 }, {
      assetId: soulAssetId,
    });
    const refId = store.addNode("image", { x: 0, y: 400 }, {
      assetId: imageAssetId,
      url: "https://example.com/ref.jpg",
    });
    const genId = store.addNode("higgsfield-image-gen", { x: 300, y: 100 }, {});
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
    store.addEdge({
      source: refId,
      sourceHandle: "out",
      target: genId,
      targetHandle: "image",
    });

    const { result } = await runFromStore();
    expect(result.ok).toBe(true);
    const callArgs = callMock.mock.calls[0]![0];
    expect(callArgs.mode).toBe("reference");
    expect(callArgs.referenceUrl).toBe("https://example.com/ref.jpg");
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* Recipe 3 — workflow shape introspection (what an LLM would query)     */
/* ────────────────────────────────────────────────────────────────────── */

describe("workflow introspection for an LLM", () => {
  it("nodeRegistry.list() exposes every kind + its inputs/outputs", () => {
    const list = nodeRegistry.list();
    const kinds = list.map((s) => s.kind).sort();
    // Slice 4 ships at least these:
    expect(kinds).toEqual(
      expect.arrayContaining([
        "text",
        "image",
        "llm-text",
        "soul-id",
        "higgsfield-image-gen",
      ]),
    );

    // Each schema declares its inputs/outputs/category — enough metadata
    // for an LLM to figure out which edges are legal.
    const gen = list.find((s) => s.kind === "higgsfield-image-gen")!;
    expect(gen.category).toBe("ai-image");
    expect(gen.inputs.map((i) => i.id).sort()).toEqual(
      ["image", "prompt", "soulId"].sort(),
    );
    expect(gen.outputs[0]?.dataType).toBe("image");
  });

  it("workflow-store reports the live graph after addNode/addEdge", () => {
    const store = useWorkflowStore.getState();
    const a = store.addNode("text", { x: 0, y: 0 }, { text: "hi" });
    const b = store.addNode("llm-text", { x: 200, y: 0 }, {});
    store.addEdge({
      source: a,
      sourceHandle: "out",
      target: b,
      targetHandle: "user",
    });

    const { nodes, edges } = useWorkflowStore.getState();
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.kind).sort()).toEqual(["llm-text", "text"]);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe(a);
    expect(edges[0]?.target).toBe(b);
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* Recipe 4 — full Soul Image Burst close-the-loop with Export           */
/* ────────────────────────────────────────────────────────────────────── */

describe("LLM-callable recipe path — full burst with Export saves to Library", () => {
  it("Text + SoulID + HiggsfieldImageGen(batch=4) + Export → 4 ImageAssets in the Library", async () => {
    callMock.mockResolvedValueOnce({
      imageUrls: [
        "https://cdn.example/burst-final-1.png",
        "https://cdn.example/burst-final-2.png",
        "https://cdn.example/burst-final-3.png",
        "https://cdn.example/burst-final-4.png",
      ],
      requestId: "req-final",
      model: "higgsfield-ai/soul/v2/standard",
    });

    const soulAssetId = useAssetStore.getState().importSoulIdAsset({
      customReferenceId: "b66a1caa-612f-440d-8353-debceb00aae6",
      variant: "v2",
      name: "Test Soul",
      thumbnailUrl: null,
    });

    // Library starts with 1 asset (the Soul ID we just imported).
    expect(useAssetStore.getState().assets).toHaveLength(1);

    const store = useWorkflowStore.getState();
    const promptId = store.addNode(
      "text",
      { x: 0, y: 0 },
      { text: "editorial portrait, soft window light" },
    );
    const soulId = store.addNode(
      "soul-id",
      { x: 0, y: 200 },
      { assetId: soulAssetId },
    );
    const genId = store.addNode("higgsfield-image-gen", { x: 300, y: 100 }, {
      batchSize: 4,
      aspectRatio: "1:1",
      resolution: "720p",
    });
    const exportId = store.addNode(
      "export",
      { x: 600, y: 100 },
      { namePrefix: "Burst" },
    );
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
    store.addEdge({
      source: genId,
      sourceHandle: "out",
      target: exportId,
      targetHandle: "in",
    });

    const { result, records } = await runFromStore();
    expect(result.ok).toBe(true);

    // Higgsfield was called once with batchSize: 4.
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock.mock.calls[0]![0].batchSize).toBe(4);

    // Each generated URL was downloaded + re-uploaded once.
    expect(uploadFromUrlMock).toHaveBeenCalledTimes(4);
    expect(uploadFromUrlMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://cdn.example/burst-final-1.png",
      "https://cdn.example/burst-final-2.png",
      "https://cdn.example/burst-final-3.png",
      "https://cdn.example/burst-final-4.png",
    ]);

    // Library now has 5 assets: 1 SoulID + 4 fresh images named Burst 1..4.
    const assets = useAssetStore.getState().assets;
    expect(assets).toHaveLength(5);
    const exported = assets.filter((a) => a.kind === "image");
    expect(exported.map((a) => a.name).sort()).toEqual([
      "Burst 1",
      "Burst 2",
      "Burst 3",
      "Burst 4",
    ]);
    for (const asset of exported) {
      if (asset.kind === "image") {
        expect(asset.source.type).toBe("remote");
      }
    }

    // Export node's record itself shows done with no output (it's a sink).
    expect(records.get(exportId)?.status).toBe("done");
  });

  it("ImageIterator + 3 refs + HiggsfieldImageGen + Export → 3 fan-out generations, 3 ImageAssets exported", async () => {
    // Each fan-out invocation returns 1 image (batchSize: 1).
    callMock.mockImplementation(async (args) => ({
      imageUrls: [
        `https://cdn.example/fanout-${args.referenceUrl?.slice(-5) ?? "no-ref"}.png`,
      ],
      requestId: `req-fanout-${args.referenceUrl?.slice(-5) ?? "x"}`,
      model: "higgsfield-ai/soul/v2/standard",
    }));

    const soulAssetId = useAssetStore.getState().importSoulIdAsset({
      customReferenceId: "b66a1caa-612f-440d-8353-debceb00aae6",
      variant: "v2",
      name: "Test Soul",
      thumbnailUrl: null,
    });
    const ref1 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/aaa11.jpg" });
    const ref2 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/bbb22.jpg" });
    const ref3 = useAssetStore
      .getState()
      .createImageAssetFromUrl({ url: "https://example.com/ccc33.jpg" });

    const store = useWorkflowStore.getState();
    const promptId = store.addNode(
      "text",
      { x: 0, y: 0 },
      { text: "editorial portrait" },
    );
    const soulId = store.addNode(
      "soul-id",
      { x: 0, y: 200 },
      { assetId: soulAssetId },
    );
    // Slice 5.6 (ADR-0032): Image Iterator links to an AssetGroup.
    const groupId = useAssetStore.getState().createGroup({
      name: "Burst refs",
      assetIds: [ref1, ref2, ref3],
      isUntitled: false,
    });
    const iterId = store.addNode("image-iterator", { x: 200, y: 500 }, {
      groupId,
      cursor: 0,
      selectionMode: "all",
    });
    const genId = store.addNode("higgsfield-image-gen", { x: 400, y: 100 }, {});
    const exportId = store.addNode(
      "export",
      { x: 700, y: 100 },
      { namePrefix: "Variant" },
    );

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
    store.addEdge({
      source: iterId,
      sourceHandle: "out",
      target: genId,
      targetHandle: "image",
    });
    store.addEdge({
      source: genId,
      sourceHandle: "out",
      target: exportId,
      targetHandle: "in",
    });

    const { result, records } = await runFromStore();
    expect(result.ok).toBe(true);

    // Fan-out: 3 separate generator invocations.
    expect(callMock).toHaveBeenCalledTimes(3);
    // Then 3 uploads to Library.
    expect(uploadFromUrlMock).toHaveBeenCalledTimes(3);

    // Library: 1 SoulID + 3 image refs + 1 AssetGroup (Slice 5.6) + 3
    // exported = 8 total.
    const assets = useAssetStore.getState().assets;
    expect(assets).toHaveLength(8);
    const exported = assets
      .filter((a) => a.kind === "image" && a.name.startsWith("Variant"))
      .map((a) => a.name)
      .sort();
    expect(exported).toEqual(["Variant 1", "Variant 2", "Variant 3"]);

    // Generator's record shows fan-out 3/3.
    expect(records.get(genId)?.fanOut).toEqual({ total: 3, done: 3 });
    expect(records.get(exportId)?.status).toBe("done");
  });
});
