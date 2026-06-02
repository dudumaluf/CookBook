import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Phase D2 — system recipe migration shape tests.
 *
 * The four D2 migrations ship system recipes by raw SQL. Tests can't
 * round-trip them through Postgres, so we instead read the migration
 * files, extract the JSONB subgraph (delimited by `$json$ … $json$`
 * dollar-quoted blocks) or the appended template chunk, and validate:
 *
 *   1. Shape of every recipe (nodes + edges + exposed I/O).
 *   2. Edge endpoints reference real node ids.
 *   3. Exposed I/O `internalNodeId`s reference real node ids.
 *   4. Cursor-driven templates split into the expected number of
 *      slices by the `═══BREAK═══` delimiter.
 *
 * Catches typos / dangling references in the SQL before the user
 * notices a broken recipe in the Library.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "supabase", "migrations");

interface RecipeSubgraph {
  version: number;
  nodes: Array<{ id: string; kind: string; config?: Record<string, unknown> }>;
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
  exposedParams: Array<{
    internalNodeId: string;
    configKey: string;
    label: string;
    control: string;
    [k: string]: unknown;
  }>;
}

/**
 * Pull the JSON between the first pair of `$json$` markers in the
 * migration file. The Seedance + new D2 recipes all use this exact
 * dollar-quoted JSONB pattern.
 */
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

function assertSubgraphConsistency(label: string, sg: RecipeSubgraph) {
  expect(sg.version, `${label}: subgraph version`).toBe(2);
  expect(sg.nodes.length, `${label}: nodes`).toBeGreaterThan(0);
  expect(sg.edges.length, `${label}: edges`).toBeGreaterThan(0);

  const nodeIds = new Set(sg.nodes.map((n) => n.id));
  expect(
    new Set(sg.nodes.map((n) => n.id)).size,
    `${label}: unique node ids`,
  ).toBe(sg.nodes.length);

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
  for (const p of sg.exposedParams) {
    expect(
      nodeIds.has(p.internalNodeId),
      `${label}: exposed param ${p.label} -> ${p.internalNodeId} exists`,
    ).toBe(true);
  }
}

function templatesText(sg: RecipeSubgraph): string {
  const node = sg.nodes.find((n) => n.id === "templates-text");
  expect(node, "templates-text node present").toBeTruthy();
  const text = (node!.config as { text?: string } | undefined)?.text;
  expect(typeof text === "string" && text.length > 0).toBe(true);
  return text!;
}

describe("Phase D2 — Storyboard Director recipe migration", () => {
  const path = join(MIGRATIONS_DIR, "20260601_storyboard_director_recipe.sql");

  it("subgraph passes shape + reference validation", () => {
    const sg = extractRecipeSubgraph(path);
    assertSubgraphConsistency("Storyboard Director", sg);
    expect(sg.nodes).toHaveLength(6);
    expect(sg.edges).toHaveLength(5);
    expect(sg.exposedInputs).toHaveLength(5);
    expect(sg.exposedOutputs).toHaveLength(1);
    expect(sg.exposedParams).toHaveLength(3);
    expect(sg.exposedOutputs[0]?.label).toBe("storyboard");
  });

  it("base-principles text bakes in the 10 continuity rules", () => {
    const sg = extractRecipeSubgraph(path);
    const base = sg.nodes.find((n) => n.id === "base-principles");
    const text = (base?.config as { text?: string }).text ?? "";
    expect(text).toMatch(/10 CINEMATIC CONTINUITY RULES/);
    for (const n of [
      "Subject identity",
      "Spatial logic",
      "180° rule",
      "Eyeline match",
      "Match cuts",
      "Wide → Medium → Close",
      "Time progression",
      "Audio bridge",
      "Lighting consistency",
      "One emotional beat",
    ]) {
      expect(text, `rule "${n}" present`).toContain(n);
    }
  });

  it("templates-text holds 5 panel-count templates separated by ═══BREAK═══", () => {
    const sg = extractRecipeSubgraph(path);
    const slices = templatesText(sg).split("═══BREAK═══");
    expect(slices).toHaveLength(5);
    expect(slices[0]).toMatch(/4 PANELS/);
    expect(slices[1]).toMatch(/6 PANELS.*DEFAULT/);
    expect(slices[2]).toMatch(/8 PANELS/);
    expect(slices[3]).toMatch(/10 PANELS/);
    expect(slices[4]).toMatch(/12 PANELS/);
  });

  it("default cursor lands on 6 panels (cursor=1)", () => {
    const sg = extractRecipeSubgraph(path);
    const list = sg.nodes.find((n) => n.id === "templates-list");
    expect((list?.config as { cursor?: number }).cursor).toBe(1);
  });
});

describe("Phase D2 — Simple Scene Prompter recipe migration", () => {
  const path = join(MIGRATIONS_DIR, "20260601_simple_scene_prompter_recipe.sql");

  it("subgraph passes shape + reference validation", () => {
    const sg = extractRecipeSubgraph(path);
    assertSubgraphConsistency("Simple Scene Prompter", sg);
    expect(sg.nodes).toHaveLength(6);
    expect(sg.edges).toHaveLength(5);
    expect(sg.exposedInputs).toHaveLength(5);
    expect(sg.exposedOutputs).toHaveLength(1);
    expect(sg.exposedParams).toHaveLength(3);
    expect(sg.exposedOutputs[0]?.label).toBe("prompt");
  });

  it("templates-text holds 5 aspect-ratio templates", () => {
    const sg = extractRecipeSubgraph(path);
    const slices = templatesText(sg).split("═══BREAK═══");
    expect(slices).toHaveLength(5);
    expect(slices[0]).toMatch(/16:9 CINEMA.*DEFAULT/);
    expect(slices[1]).toMatch(/9:16 VERTICAL/);
    expect(slices[2]).toMatch(/1:1 SQUARE/);
    expect(slices[3]).toMatch(/4:3 CLASSIC/);
    expect(slices[4]).toMatch(/21:9 CINEMATIC/);
  });

  it("default cursor lands on 16:9 (cursor=0)", () => {
    const sg = extractRecipeSubgraph(path);
    const list = sg.nodes.find((n) => n.id === "templates-list");
    expect((list?.config as { cursor?: number }).cursor).toBe(0);
  });

  it("base-principles text enforces the three-slot structure", () => {
    const sg = extractRecipeSubgraph(path);
    const base = sg.nodes.find((n) => n.id === "base-principles");
    const text = (base?.config as { text?: string }).text ?? "";
    expect(text).toMatch(/Subject \+ Action FIRST/);
    expect(text).toMatch(/Camera SECOND/);
    expect(text).toMatch(/Audio THIRD/);
    expect(text).toMatch(/2-4 sentences/);
  });
});

describe("Phase D2 — Timeline Director recipe migration", () => {
  const path = join(MIGRATIONS_DIR, "20260601_timeline_director_recipe.sql");

  it("subgraph passes shape + reference validation", () => {
    const sg = extractRecipeSubgraph(path);
    assertSubgraphConsistency("Timeline Director", sg);
    expect(sg.nodes).toHaveLength(6);
    expect(sg.edges).toHaveLength(5);
    expect(sg.exposedInputs).toHaveLength(5);
    expect(sg.exposedOutputs).toHaveLength(1);
    expect(sg.exposedParams).toHaveLength(3);
    expect(sg.exposedOutputs[0]?.label).toBe("timeline");
  });

  it("base-principles bakes in the 5 setup blocks + [mm:ss-mm:ss] format", () => {
    const sg = extractRecipeSubgraph(path);
    const base = sg.nodes.find((n) => n.id === "base-principles");
    const text = (base?.config as { text?: string }).text ?? "";
    for (const block of [
      "Character",
      "Setting",
      "Tone",
      "Constraints",
      "Goal",
    ]) {
      expect(text, `setup block "${block}" present`).toContain(block);
    }
    expect(text).toMatch(/\[mm:ss-mm:ss\]/);
    expect(text).toMatch(/FIVE SETUP BLOCKS/);
  });

  it("templates-text holds 5 duration/slot-count combos", () => {
    const sg = extractRecipeSubgraph(path);
    const slices = templatesText(sg).split("═══BREAK═══");
    expect(slices).toHaveLength(5);
    expect(slices[0]).toMatch(/8s \/ 3 SLOTS/);
    expect(slices[1]).toMatch(/10s \/ 4 SLOTS.*DEFAULT/);
    expect(slices[2]).toMatch(/12s \/ 4 SLOTS/);
    expect(slices[3]).toMatch(/15s \/ 5 SLOTS/);
    expect(slices[4]).toMatch(/5s \/ 3 SLOTS/);
  });

  it("default cursor lands on 10s/4 slots (cursor=1)", () => {
    const sg = extractRecipeSubgraph(path);
    const list = sg.nodes.find((n) => n.id === "templates-list");
    expect((list?.config as { cursor?: number }).cursor).toBe(1);
  });
});

describe("Phase D2 — Seedance Director v2 migration (Animation template)", () => {
  const path = join(
    MIGRATIONS_DIR,
    "20260602_seedance_director_v2_animation.sql",
  );

  it("is wrapped in an idempotent DO block guarded by version=1", () => {
    const sql = readFileSync(path, "utf-8");
    expect(sql).toMatch(/do \$migrate\$/);
    expect(sql).toMatch(/curr_version >= 2/);
    expect(sql).toMatch(/skipping/);
  });

  it("archives v1 to cookbook_recipe_versions before bumping", () => {
    const sql = readFileSync(path, "utf-8");
    const archiveIdx = sql.indexOf(
      "insert into public.cookbook_recipe_versions",
    );
    const updateIdx = sql.indexOf("update public.cookbook_recipes");
    expect(archiveIdx).toBeGreaterThan(0);
    expect(updateIdx).toBeGreaterThan(0);
    expect(archiveIdx).toBeLessThan(updateIdx);
  });

  it("appends the Animation template + widens cursor max to 5", () => {
    const sql = readFileSync(path, "utf-8");
    expect(sql).toMatch(
      /TEMPLATE: ANIMATION \/ TIMED SEGMENTS \(multi-beat single shot\)/,
    );
    expect(sql).toMatch(/'\{max\}'/);
    expect(sql).toMatch(/to_jsonb\(5\)/);
    expect(sql).toMatch(/0:Free 1:1-shot 2:Multi 3:Transform 4:Orb 5:Animation/);
  });

  it("bumps version to 2 (single-step bump)", () => {
    const sql = readFileSync(path, "utf-8");
    expect(sql).toMatch(/version = 2/);
  });

  it("updates the live recipe description to mention the Animation template", () => {
    const sql = readFileSync(path, "utf-8");
    expect(sql).toMatch(
      /Freeform \/ Single-shot \/ Multi-shot Commercial \/ Transformation \/ Orb-POV \/ Animation/,
    );
  });
});
