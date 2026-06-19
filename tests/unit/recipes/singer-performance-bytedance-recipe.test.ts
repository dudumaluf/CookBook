import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHARACTER_SWAP_PROMPT,
  KEYFRAME_ANCHORED_SINGING_PROMPT,
} from "@/lib/assistant/knowledge/performance-prompts";

/**
 * Singer Performance (ByteDance) recipe migration — shape + reference tests.
 *
 * The recipe ships as raw SQL (a `$json$ … $json$` JSONB subgraph), so tests
 * can't round-trip it through Postgres. Instead we read the migration file,
 * parse the subgraph, and validate node/edge/exposed-I/O consistency plus the
 * ByteDance staging — and pin the two Text nodes' defaults to the canonical
 * prompt constants so the SQL and TS can never silently drift.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "supabase", "migrations");
const RECIPE_PATH = join(
  MIGRATIONS_DIR,
  "20260619_singer_performance_bytedance_recipe.sql",
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
    throw new Error("No $json$ block found in the ByteDance recipe migration");
  }
  const jsonText = sql.slice(start + "$json$".length, end);
  return JSON.parse(jsonText) as Subgraph;
}

function nodeById(sg: Subgraph, id: string) {
  return sg.nodes.find((n) => n.id === id);
}

describe("Singer Performance (ByteDance) recipe migration", () => {
  it("subgraph passes shape + reference validation", () => {
    const sg = extractSubgraph();
    expect(sg.version).toBe(2);
    expect(sg.nodes).toHaveLength(16);
    expect(sg.edges).toHaveLength(21);

    const ids = new Set(sg.nodes.map((n) => n.id));
    expect(ids.size).toBe(sg.nodes.length); // unique ids
    for (const e of sg.edges) {
      expect(ids.has(e.source), `edge ${e.id} source ${e.source}`).toBe(true);
      expect(ids.has(e.target), `edge ${e.id} target ${e.target}`).toBe(true);
    }

    expect(sg.exposedInputs).toHaveLength(0);
    expect(sg.exposedOutputs).toHaveLength(1);
    expect(sg.exposedOutputs[0]).toMatchObject({
      internalNodeId: "sing",
      internalHandleId: "out",
      label: "video",
      dataType: "video",
    });
    expect(ids.has(sg.exposedOutputs[0]!.internalNodeId)).toBe(true);
  });

  it("wires the three ByteDance stages", () => {
    const sg = extractSubgraph();

    // Stage 1 — character swap.
    expect(nodeById(sg, "swap")?.kind).toBe("seedance-video");
    const swapEdges = sg.edges.filter((e) => e.target === "swap");
    expect(swapEdges.map((e) => e.targetHandle).sort()).toEqual([
      "image-0",
      "prompt",
      "video-0",
    ]);

    // Stage 2 — decompose: frames extract (span, 7) + audio→silent video.
    const frames = nodeById(sg, "frames");
    expect(frames?.kind).toBe("frames-extract");
    expect(frames?.config).toMatchObject({ mode: "span", count: 7 });
    expect(nodeById(sg, "audio2video")?.kind).toBe("audio-to-video");
    // The swapped clip feeds the frame extractor.
    expect(
      sg.edges.some(
        (e) => e.source === "swap" && e.target === "frames" && e.targetHandle === "video",
      ),
    ).toBe(true);

    // Stage 3 — keyframe-anchored singing.
    const sing = nodeById(sg, "sing");
    expect(sing?.kind).toBe("seedance-video");
    expect(sing?.config).toMatchObject({ imagePorts: 7 });

    // 7 List pickers (cursor 0..6), each fed the keyframe array, each into a
    // distinct Seedance image socket.
    for (let i = 0; i < 7; i++) {
      const list = nodeById(sg, `kf${i}`);
      expect(list?.kind, `kf${i} kind`).toBe("list");
      expect(list?.config, `kf${i} cursor`).toMatchObject({
        cursor: i,
        mode: "fixed",
      });
      expect(
        sg.edges.some(
          (e) => e.source === "frames" && e.target === `kf${i}` && e.targetHandle === "items",
        ),
        `frames -> kf${i}.items`,
      ).toBe(true);
      expect(
        sg.edges.some(
          (e) => e.source === `kf${i}` && e.target === "sing" && e.targetHandle === `image-${i}`,
        ),
        `kf${i} -> sing.image-${i}`,
      ).toBe(true);
    }

    // The black-screen song rides the video channel as @Video1.
    expect(
      sg.edges.some(
        (e) =>
          e.source === "audio2video" &&
          e.target === "sing" &&
          e.targetHandle === "video-0",
      ),
      "audio2video -> sing.video-0",
    ).toBe(true);
  });

  it("Text nodes default to the canonical ByteDance prompts verbatim", () => {
    const sg = extractSubgraph();
    const swapText = (nodeById(sg, "prompt-swap")?.config as { text?: string })?.text;
    const singText = (nodeById(sg, "prompt-sing")?.config as { text?: string })?.text;
    // Pinned to the TS source of truth so SQL ↔ TS can't drift.
    expect(swapText).toBe(CHARACTER_SWAP_PROMPT);
    expect(singText).toBe(KEYFRAME_ANCHORED_SINGING_PROMPT);
  });
});
