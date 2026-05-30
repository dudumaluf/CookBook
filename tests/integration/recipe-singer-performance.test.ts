import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWorkflow, type ExecutionCache } from "@/lib/engine/run-workflow";
import { nodeRegistry } from "@/lib/engine/registry";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { ExecutionRecord, StandardizedOutput } from "@/types/node";

/**
 * Integration test for the modular "Singer Performance" pipeline — proves
 * the decomposed graph (Audio Slicer / Video Slicer / List / Seedance /
 * Frame Extract / Video Concat) ASSEMBLES and RUNS end-to-end, with each
 * chunk's Seedance call receiving the right per-chunk slices + continuity
 * frame. This is the validated graph we ship as a recipe.
 *
 * The hard loop (dynamic N) stays in the Continuity Builder; this is the
 * fixed 2-chunk UNROLL — a DAG, so it's fully expressible as nodes/edges.
 */

const {
  callSeedanceVideo,
  probeMedia,
  sliceAudio,
  sliceVideo,
  extractFrame,
  concatVideos,
  uploadImageAsset,
  uploadMediaAsset,
} = vi.hoisted(() => ({
  callSeedanceVideo: vi.fn(),
  probeMedia: vi.fn(),
  sliceAudio: vi.fn(),
  sliceVideo: vi.fn(),
  extractFrame: vi.fn(),
  concatVideos: vi.fn(),
  uploadImageAsset: vi.fn(),
  uploadMediaAsset: vi.fn(),
}));

vi.mock("@/lib/fal/call-seedance", () => ({
  callSeedanceVideo,
  FalCallError: class extends Error {},
}));
vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset,
  uploadMediaAsset,
}));
// Keep the pure windowing + constraint math real; mock only the WebCodecs ops
// (which can't run in happy-dom) and uploads.
vi.mock("@/lib/media", async () => {
  const windows = await vi.importActual<typeof import("@/lib/media/windows")>(
    "@/lib/media/windows",
  );
  const constraints = await vi.importActual<
    typeof import("@/lib/media/constraints")
  >("@/lib/media/constraints");
  return {
    ...windows,
    ...constraints,
    probeMedia,
    sliceAudio,
    sliceVideo,
    extractFrame,
    concatVideos,
  };
});

await import("@/lib/engine/all-nodes");

beforeEach(() => {
  useWorkflowStore.getState().clear();
  useAssetStore.getState().clear();

  for (const m of [
    callSeedanceVideo,
    probeMedia,
    sliceAudio,
    sliceVideo,
    extractFrame,
    concatVideos,
    uploadImageAsset,
    uploadMediaAsset,
  ]) {
    m.mockReset();
  }

  // 30s media → two 15s windows.
  probeMedia.mockResolvedValue({ durationMs: 30000 });
  sliceAudio.mockResolvedValue([
    new Blob(["a0"], { type: "audio/wav" }),
    new Blob(["a1"], { type: "audio/wav" }),
  ]);
  sliceVideo.mockResolvedValue([
    new Blob(["v0"], { type: "video/mp4" }),
    new Blob(["v1"], { type: "video/mp4" }),
  ]);
  extractFrame.mockResolvedValue(new Blob(["frame"], { type: "image/png" }));
  concatVideos.mockResolvedValue(new Blob(["joined"], { type: "video/mp4" }));

  // Uploads echo the file name so we can assert which slice went where.
  uploadImageAsset.mockImplementation((file: File) =>
    Promise.resolve({ url: `https://cdn/${file.name}` }),
  );
  uploadMediaAsset.mockImplementation((file: File) =>
    Promise.resolve({ url: `https://cdn/${file.name}` }),
  );

  // Each Seedance chunk returns a distinct clip url.
  let chunk = 0;
  callSeedanceVideo.mockImplementation(() =>
    Promise.resolve({
      videoUrl: `https://cdn/seedance-chunk-${++chunk}.mp4`,
      mime: "video/mp4",
      model: "bytedance/seedance-2.0/reference-to-video",
    }),
  );
});

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

describe("Singer Performance — modular 2-chunk unroll", () => {
  it("assembles + runs: per-chunk slices feed Seedance, last frame chains continuity, clips concat", async () => {
    const s = useWorkflowStore.getState();

    // Inputs the user provides.
    const prompt = s.addNode("text", { x: 0, y: 0 }, {
      text: "the character sings the song, matching the performance",
    });
    const character = s.addNode("image", { x: 0, y: 120 }, {
      url: "https://x/character.png",
    });
    const song = s.addNode("audio", { x: 0, y: 240 }, {
      url: "https://x/song.mp3",
    });
    const perf = s.addNode("video", { x: 0, y: 360 }, {
      url: "https://x/performance.mp4",
    });

    // Slicers.
    const aSlice = s.addNode("audio-slicer", { x: 240, y: 240 }, {
      windowSec: 15,
    });
    const vSlice = s.addNode("video-slicer", { x: 240, y: 360 }, {
      windowSec: 15,
      maxHeight: "720p",
    });
    s.addEdge({ source: song, sourceHandle: "out", target: aSlice, targetHandle: "audio" });
    s.addEdge({ source: perf, sourceHandle: "out", target: vSlice, targetHandle: "video" });

    // Per-chunk selectors (fixed cursor = chunk index).
    const aPick0 = s.addNode("list", { x: 480, y: 200 }, { cursor: 0, mode: "fixed" });
    const aPick1 = s.addNode("list", { x: 480, y: 500 }, { cursor: 1, mode: "fixed" });
    const vPick0 = s.addNode("list", { x: 480, y: 300 }, { cursor: 0, mode: "fixed" });
    const vPick1 = s.addNode("list", { x: 480, y: 600 }, { cursor: 1, mode: "fixed" });
    for (const p of [aPick0, aPick1])
      s.addEdge({ source: aSlice, sourceHandle: "out", target: p, targetHandle: "items" });
    for (const p of [vPick0, vPick1])
      s.addEdge({ source: vSlice, sourceHandle: "out", target: p, targetHandle: "items" });

    // Chunk 0 — character identity + first performance slice.
    const seed0 = s.addNode("seedance-video", { x: 720, y: 240 }, {});
    s.addEdge({ source: prompt, sourceHandle: "out", target: seed0, targetHandle: "prompt" });
    s.addEdge({ source: character, sourceHandle: "out", target: seed0, targetHandle: "image" });
    s.addEdge({ source: vPick0, sourceHandle: "out", target: seed0, targetHandle: "video" });
    s.addEdge({ source: aPick0, sourceHandle: "out", target: seed0, targetHandle: "audio" });

    // Continuity: chunk 0's last frame.
    const frame0 = s.addNode("frame-extract", { x: 960, y: 240 }, { position: "last" });
    s.addEdge({ source: seed0, sourceHandle: "out", target: frame0, targetHandle: "video" });

    // Chunk 1 — character + previous last frame (continuity) + second slice.
    const seed1 = s.addNode("seedance-video", { x: 1200, y: 500 }, {});
    s.addEdge({ source: prompt, sourceHandle: "out", target: seed1, targetHandle: "prompt" });
    s.addEdge({ source: character, sourceHandle: "out", target: seed1, targetHandle: "image" });
    s.addEdge({ source: frame0, sourceHandle: "out", target: seed1, targetHandle: "image" });
    s.addEdge({ source: vPick1, sourceHandle: "out", target: seed1, targetHandle: "video" });
    s.addEdge({ source: aPick1, sourceHandle: "out", target: seed1, targetHandle: "audio" });

    // Join — ordered clip sockets (ADR-0056).
    const concat = s.addNode("video-concat", { x: 1440, y: 360 }, { portCount: 2 });
    s.addEdge({ source: seed0, sourceHandle: "out", target: concat, targetHandle: "clip-0" });
    s.addEdge({ source: seed1, sourceHandle: "out", target: concat, targetHandle: "clip-1" });

    const { result, records } = await runFromStore();
    expect(result.ok).toBe(true);

    // Two Seedance generations (one per chunk).
    expect(callSeedanceVideo).toHaveBeenCalledTimes(2);

    // Identify each chunk's call by its audio slice.
    const calls = callSeedanceVideo.mock.calls.map((c) => c[0]);
    const c0 = calls.find((a) => a.audioUrls?.[0] === "https://cdn/chunk-1.wav")!;
    const c1 = calls.find((a) => a.audioUrls?.[0] === "https://cdn/chunk-2.wav")!;
    expect(c0).toBeDefined();
    expect(c1).toBeDefined();

    // Chunk 0: first video slice + character identity, no continuity frame yet.
    expect(c0.videoUrls).toEqual(["https://cdn/chunk-1.mp4"]);
    expect(c0.imageUrls).toEqual(["https://x/character.png"]);

    // Chunk 1: second video slice + character + the extracted last frame.
    expect(c1.videoUrls).toEqual(["https://cdn/chunk-2.mp4"]);
    expect(c1.imageUrls).toEqual([
      "https://x/character.png",
      "https://cdn/frame-last.png",
    ]);

    // Frame extracted from chunk 0's clip.
    expect(extractFrame).toHaveBeenCalledWith(
      "https://cdn/seedance-chunk-1.mp4",
      "last",
    );

    // Concat joined both chunks, in order.
    expect(concatVideos).toHaveBeenCalledTimes(1);
    expect(concatVideos.mock.calls[0]![0]).toEqual([
      "https://cdn/seedance-chunk-1.mp4",
      "https://cdn/seedance-chunk-2.mp4",
    ]);

    const out = records.get(concat)?.output as StandardizedOutput;
    expect(out.type).toBe("video");
    if (out.type === "video") expect(out.value.url).toBe("https://cdn/joined.mp4");
  });
});
