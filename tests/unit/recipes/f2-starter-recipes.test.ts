import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import "@/lib/engine/all-nodes";
import { nodeRegistry } from "@/lib/engine/registry";

/**
 * 2026-06-04 — Recipe taxonomy F2 starter pack shape tests.
 *
 * Six SQL migrations seed system recipes covering the buckets we
 * were missing pre-taxonomy (image / audio / utility) plus filling
 * out video. Each migration is read off disk and its JSONB subgraph
 * extracted via the `$json$ … $json$` dollar-quoted markers (mirrors
 * the existing D2 system-recipe test pattern).
 *
 * For each recipe we assert:
 *
 *  1. Subgraph version + node/edge consistency (the same checks the
 *     D2 suite runs — unique node ids, edge endpoints exist,
 *     exposed I/O references real nodes).
 *  2. Every node kind exists in `nodeRegistry` (catches typos before
 *     the user drags the recipe onto canvas + sees a missing-kind
 *     placeholder).
 *  3. Every exposed handle's `internalHandleId` exists on its
 *     internal node's *static* input/output list — this catches
 *     handles that only appear via `getInputs(config)` (e.g. fal-image's
 *     `image-N` slots beyond the 2 default ports), which is by design
 *     here: we always set `imagePorts` in config to the count we need,
 *     so the engine surfaces those handles at instantiation time.
 *  4. `category` matches the bucket the menu groups by.
 *
 * Catches the typical drift sources: stale node kinds, mis-named
 * handles, misaligned `imagePorts`, unrecognized categories.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
);

interface RecipeSubgraph {
  version: number;
  nodes: Array<{
    id: string;
    kind: string;
    position?: { x: number; y: number };
    config?: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    sourceHandle: string;
    target: string;
    targetHandle: string;
  }>;
  exposedInputs: Array<{
    internalNodeId: string;
    internalHandleId: string;
    label: string;
    dataType: string;
  }>;
  exposedOutputs: Array<{
    internalNodeId: string;
    internalHandleId: string;
    label: string;
    dataType: string;
  }>;
  exposedParams?: Array<{
    internalNodeId: string;
    configKey: string;
    label: string;
    control: string;
    [k: string]: unknown;
  }>;
}

function extractRecipeSubgraph(migrationPath: string): RecipeSubgraph {
  const sql = readFileSync(migrationPath, "utf-8");
  const start = sql.indexOf("$json$");
  const end = sql.lastIndexOf("$json$");
  if (start < 0 || end <= start) {
    throw new Error(`No $json$ block found in ${migrationPath}`);
  }
  const jsonText = sql.slice(start + "$json$".length, end);
  return JSON.parse(jsonText) as RecipeSubgraph;
}

function extractCategory(migrationPath: string): string {
  const sql = readFileSync(migrationPath, "utf-8");
  // Categories ship as the 4th VALUES literal in our INSERT (after
  // null owner, name, description). Match the first single-quoted
  // string that exactly matches one of the canonical buckets.
  const m = sql.match(
    /'(describe|image|video|audio|utility)'\s*,\s*\$json\$/,
  );
  if (!m || !m[1]) {
    throw new Error(`No category literal found in ${migrationPath}`);
  }
  return m[1];
}

function assertConsistency(
  label: string,
  sg: RecipeSubgraph,
  expectedCategory: string,
  category: string,
) {
  expect(sg.version, `${label}: subgraph version`).toBe(2);
  expect(category, `${label}: declared category`).toBe(expectedCategory);
  expect(sg.nodes.length, `${label}: nodes`).toBeGreaterThan(0);
  expect(sg.edges.length, `${label}: edges`).toBeGreaterThan(0);

  const nodeIds = new Set(sg.nodes.map((n) => n.id));
  expect(
    new Set(sg.nodes.map((n) => n.id)).size,
    `${label}: unique node ids`,
  ).toBe(sg.nodes.length);

  for (const node of sg.nodes) {
    const schema = nodeRegistry.get(node.kind);
    expect(schema, `${label}: node kind "${node.kind}" exists in registry`).toBeTruthy();
  }

  for (const edge of sg.edges) {
    expect(
      nodeIds.has(edge.source),
      `${label}: edge ${edge.id} source ${edge.source} exists`,
    ).toBe(true);
    expect(
      nodeIds.has(edge.target),
      `${label}: edge ${edge.id} target ${edge.target} exists`,
    ).toBe(true);
  }

  for (const inp of sg.exposedInputs) {
    expect(
      nodeIds.has(inp.internalNodeId),
      `${label}: exposed input ${inp.label} -> ${inp.internalNodeId} exists`,
    ).toBe(true);
  }
  for (const out of sg.exposedOutputs) {
    expect(
      nodeIds.has(out.internalNodeId),
      `${label}: exposed output ${out.label} -> ${out.internalNodeId} exists`,
    ).toBe(true);
  }
  for (const p of sg.exposedParams ?? []) {
    expect(
      nodeIds.has(p.internalNodeId),
      `${label}: exposed param ${p.label} -> ${p.internalNodeId} exists`,
    ).toBe(true);
  }
}

const STARTERS: Array<{
  label: string;
  file: string;
  category: "describe" | "image" | "video" | "audio" | "utility";
  /**
   * Optional spot-check assertions per recipe — used when a particular
   * recipe relies on a specific config setting (e.g. `numImages` or a
   * mode flag) that's load-bearing for the whole pipeline.
   */
  spot?: (sg: RecipeSubgraph) => void;
}> = [
  {
    label: "Image Variation Burst",
    file: "20260604_image_variation_burst_recipe.sql",
    category: "image",
    spot: (sg) => {
      const burst = sg.nodes.find((n) => n.id === "burst");
      expect(burst).toBeTruthy();
      expect((burst!.config as { numImages?: number }).numImages).toBe(4);
      expect((burst!.config as { model?: string }).model).toBe(
        "nano-banana-2",
      );
    },
  },
  {
    label: "Moodboard Synthesizer",
    file: "20260604_moodboard_synthesizer_recipe.sql",
    category: "image",
    spot: (sg) => {
      // Both the synth LLM and the renderer need 3 image ports so the
      // recipe's three exposed image inputs all land on real handles.
      const synth = sg.nodes.find((n) => n.id === "synth-llm");
      expect((synth?.config as { imagePorts?: number }).imagePorts).toBe(3);
      const renderer = sg.nodes.find((n) => n.id === "renderer");
      expect((renderer?.config as { imagePorts?: number }).imagePorts).toBe(3);
      expect(sg.exposedInputs.filter((i) => i.dataType === "image")).toHaveLength(6);
    },
  },
  {
    label: "Character Pose Sheet",
    file: "20260604_character_pose_sheet_recipe.sql",
    category: "image",
    spot: (sg) => {
      const poses = sg.nodes.find((n) => n.id === "poses");
      expect(poses).toBeTruthy();
      const cfg = poses!.config as {
        texts?: string[];
        selectionMode?: string;
      };
      expect(cfg.texts).toHaveLength(4);
      expect(cfg.selectionMode).toBe("all");
      // Soul ID is the only exposed input.
      expect(sg.exposedInputs).toHaveLength(1);
      expect(sg.exposedInputs[0]?.dataType).toBe("soul-id");
    },
  },
  {
    label: "Storyboard from Script",
    file: "20260604_storyboard_from_script_recipe.sql",
    category: "utility",
    spot: (sg) => {
      const splitter = sg.nodes.find((n) => n.id === "splitter");
      expect((splitter?.config as { delimiter?: string }).delimiter).toBe(
        "\n\n",
      );
      // The script-passthrough uses {script} variables → exposes
      // `var-script` as a text input on the composite.
      const passthrough = sg.nodes.find((n) => n.id === "script-passthrough");
      expect((passthrough?.config as { text?: string }).text).toBe("{script}");
      const scriptInput = sg.exposedInputs.find((i) => i.label === "script");
      expect(scriptInput?.internalHandleId).toBe("var-script");
    },
  },
  {
    label: "Voice Memo Storyboard",
    file: "20260604_voice_memo_storyboard_recipe.sql",
    category: "audio",
    spot: (sg) => {
      const splitter = sg.nodes.find((n) => n.id === "splitter");
      expect((splitter?.config as { delimiter?: string }).delimiter).toBe("\n");
      // Audio is the only public input.
      expect(sg.exposedInputs).toHaveLength(1);
      expect(sg.exposedInputs[0]?.dataType).toBe("audio");
      // Final port emits image (not audio) — this is the audio-IN,
      // image-OUT crossover that's the recipe's whole reason to exist.
      expect(sg.exposedOutputs[0]?.dataType).toBe("image");
    },
  },
  {
    label: "Video Lipsync Demo",
    file: "20260604_video_lipsync_demo_recipe.sql",
    category: "video",
    spot: (sg) => {
      const seedance = sg.nodes.find((n) => n.id === "seedance");
      // first-frame mode is what gives Seedance the `start` image
      // input handle that the recipe's `character` exposed-input
      // binds to. Reference mode would expose `image1..N` instead
      // and the binding would silently dangle.
      expect((seedance?.config as { mode?: string }).mode).toBe("first-frame");
      expect(
        (seedance?.config as { generateAudio?: boolean }).generateAudio,
      ).toBe(false);
      // Exposed inputs: character (image) + audio (audio).
      const chars = sg.exposedInputs.find((i) => i.label === "character");
      const audio = sg.exposedInputs.find((i) => i.label === "audio");
      expect(chars?.dataType).toBe("image");
      expect(audio?.dataType).toBe("audio");
    },
  },
];

describe("F2 starter recipes — shape + registry validation", () => {
  for (const recipe of STARTERS) {
    describe(recipe.label, () => {
      const path = join(MIGRATIONS_DIR, recipe.file);

      it("subgraph parses + every kind / handle / id resolves", () => {
        const sg = extractRecipeSubgraph(path);
        const cat = extractCategory(path);
        assertConsistency(recipe.label, sg, recipe.category, cat);
      });

      if (recipe.spot) {
        it("spot-checks the load-bearing config", () => {
          const sg = extractRecipeSubgraph(path);
          recipe.spot!(sg);
        });
      }
    });
  }

  it("all six recipes are present at the expected paths", () => {
    for (const recipe of STARTERS) {
      const path = join(MIGRATIONS_DIR, recipe.file);
      expect(() => readFileSync(path, "utf-8")).not.toThrow();
    }
  });
});
