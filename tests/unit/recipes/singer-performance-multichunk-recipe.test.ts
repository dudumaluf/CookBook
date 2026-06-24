import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHARACTER_SWAP_IDENTITY_ONLY_PROMPT,
  KEYFRAME_ANCHORED_SINGING_PROMPT,
} from "@/lib/assistant/knowledge/performance-prompts";

/**
 * Singer Performance (ByteDance · multi-chunk) recipe migration — shape tests.
 *
 * Like the single-chunk sibling, the recipe ships as raw SQL (`$json$ … $json$`
 * JSONB), so we read the file, parse the subgraph, and validate the staging.
 * The key things this recipe must keep: ONE Number index driving BOTH List
 * cursors, and the keyframe array wired into Seedance via the single @Image[]
 * socket (handle id `image`) instead of N List nodes.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "supabase", "migrations");
const RECIPE_PATH = join(
  MIGRATIONS_DIR,
  "20260623_singer_performance_multichunk_recipe.sql",
);

interface Subgraph {
  version: number;
  nodes: Array<{ id: string; kind: string; config?: Record<string, unknown> }>;
  edges: Array<{
    id: string;
    source: string;
    sourceHandle: string;
    target: string;
    targetHandle: string;
  }>;
  exposedInputs: Array<{ internalNodeId: string; label: string }>;
  exposedOutputs: Array<{
    internalNodeId: string;
    internalHandleId: string;
    label: string;
    dataType: string;
  }>;
}

function extractSubgraph(): Subgraph {
  const sql = readFileSync(RECIPE_PATH, "utf-8");
  const start = sql.indexOf("$json$");
  const end = sql.lastIndexOf("$json$");
  if (start < 0 || end <= start) {
    throw new Error("No $json$ block found in the multi-chunk recipe migration");
  }
  const jsonText = sql.slice(start + "$json$".length, end);
  return JSON.parse(jsonText) as Subgraph;
}

function nodeById(sg: Subgraph, id: string) {
  return sg.nodes.find((n) => n.id === id);
}

function hasEdge(
  sg: Subgraph,
  source: string,
  target: string,
  targetHandle: string,
) {
  return sg.edges.some(
    (e) =>
      e.source === source &&
      e.target === target &&
      e.targetHandle === targetHandle,
  );
}

describe("Singer Performance (ByteDance · multi-chunk) recipe migration", () => {
  it("subgraph passes shape + reference validation", () => {
    const sg = extractSubgraph();
    expect(sg.version).toBe(2);

    const ids = new Set(sg.nodes.map((n) => n.id));
    expect(ids.size).toBe(sg.nodes.length); // unique ids
    for (const e of sg.edges) {
      expect(ids.has(e.source), `edge ${e.id} source ${e.source}`).toBe(true);
      expect(ids.has(e.target), `edge ${e.id} target ${e.target}`).toBe(true);
    }

    // Three exposed outputs: the singing window + its first/last frames.
    expect(sg.exposedInputs).toHaveLength(0);
    expect(sg.exposedOutputs).toHaveLength(3);
    for (const out of sg.exposedOutputs) {
      expect(ids.has(out.internalNodeId)).toBe(true);
    }
    expect(sg.exposedOutputs[0]).toMatchObject({
      internalNodeId: "sing",
      internalHandleId: "out",
      dataType: "video",
    });
  });

  it("one Number index drives BOTH List pickers' cursors", () => {
    const sg = extractSubgraph();
    expect(nodeById(sg, "chunk-index")?.kind).toBe("number");
    expect(nodeById(sg, "apick")?.kind).toBe("list");
    expect(nodeById(sg, "vpick")?.kind).toBe("list");
    // The slicers feed each picker's array port…
    expect(hasEdge(sg, "aslice", "apick", "items")).toBe(true);
    expect(hasEdge(sg, "vslice", "vpick", "items")).toBe(true);
    // …and the SAME Number node drives both cursors (step chunk-by-chunk).
    expect(hasEdge(sg, "chunk-index", "apick", "cursor")).toBe(true);
    expect(hasEdge(sg, "chunk-index", "vpick", "cursor")).toBe(true);
  });

  it("wires the three ByteDance stages per chunk", () => {
    const sg = extractSubgraph();

    // Stage 1 — identity-only character swap (prompt + character + video chunk).
    expect(nodeById(sg, "swap")?.kind).toBe("seedance-video");
    expect(hasEdge(sg, "prompt-swap", "swap", "prompt")).toBe(true);
    expect(hasEdge(sg, "character", "swap", "image-0")).toBe(true);
    expect(hasEdge(sg, "vpick", "swap", "video-0")).toBe(true);

    // Stage 2 — decompose: 9 keyframes + the audio chunk as a Silent Video.
    const frames = nodeById(sg, "frames");
    expect(frames?.kind).toBe("frames-extract");
    expect(frames?.config).toMatchObject({ mode: "span", count: 9 });
    expect(nodeById(sg, "silent")?.kind).toBe("audio-to-video");
    expect(hasEdge(sg, "swap", "frames", "video")).toBe(true);
    expect(hasEdge(sg, "apick", "silent", "audio")).toBe(true);

    // Stage 3 — keyframe-anchored singing.
    expect(nodeById(sg, "sing")?.kind).toBe("seedance-video");
    expect(hasEdge(sg, "prompt-sing", "sing", "prompt")).toBe(true);
    // The black-screen song rides the video channel as @Video1.
    expect(hasEdge(sg, "silent", "sing", "video-0")).toBe(true);
  });

  it("fans the keyframe array through the SINGLE @Image[] socket (no N List nodes)", () => {
    const sg = extractSubgraph();
    // Frames Extract → sing.image (the multiple image-array socket). This is
    // the whole point of the array socket: one wire instead of nine List nodes.
    expect(hasEdge(sg, "frames", "sing", "image")).toBe(true);
    // And there are NO `list` nodes between frames and sing (kf0..kf8 gone).
    const listNodes = sg.nodes.filter((n) => n.kind === "list");
    expect(listNodes.map((n) => n.id).sort()).toEqual(["apick", "vpick"]);
  });

  it("extracts the window's first + last frames for stitching", () => {
    const sg = extractSubgraph();
    expect(nodeById(sg, "first-frame")?.config).toMatchObject({
      position: "first",
    });
    expect(nodeById(sg, "last-frame")?.config).toMatchObject({
      position: "last",
    });
    expect(hasEdge(sg, "sing", "first-frame", "video")).toBe(true);
    expect(hasEdge(sg, "sing", "last-frame", "video")).toBe(true);
  });

  it("Text nodes default to the canonical ByteDance prompts verbatim", () => {
    const sg = extractSubgraph();
    const swapText = (nodeById(sg, "prompt-swap")?.config as { text?: string })
      ?.text;
    const singText = (nodeById(sg, "prompt-sing")?.config as { text?: string })
      ?.text;
    expect(swapText).toBe(CHARACTER_SWAP_IDENTITY_ONLY_PROMPT);
    expect(singText).toBe(KEYFRAME_ANCHORED_SINGING_PROMPT);
  });
});
