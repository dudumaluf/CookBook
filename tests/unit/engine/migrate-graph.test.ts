import { describe, expect, it } from "vitest";

import {
  migrateArrayLegacyDelimiter,
  migrateFalImageModelNormalization,
  migrateFalImageSmartInputs,
  migrateLlmTextCollapseUserPorts,
  migrateLlmTextSmartInputs,
  migrateSeedanceRefHandles,
  migrateVideoConcatClips,
} from "@/lib/engine/migrate-graph";
import type { NodeInstance, WorkflowEdge } from "@/types/node";

const concat = (id: string): NodeInstance => ({
  id,
  kind: "video-concat",
  position: { x: 0, y: 0 },
  config: {},
});

describe("migrateVideoConcatClips", () => {
  it("rewrites legacy `clips` edges to ordered clip-N sockets + sets portCount", () => {
    const nodes = [concat("c1")];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", sourceHandle: "out", target: "c1", targetHandle: "clips" },
      { id: "e2", source: "b", sourceHandle: "out", target: "c1", targetHandle: "clips" },
    ];
    const out = migrateVideoConcatClips(nodes, edges);
    expect(out.edges.map((e) => e.targetHandle)).toEqual(["clip-0", "clip-1"]);
    expect((out.nodes[0]!.config as { portCount: number }).portCount).toBe(3);
  });

  it("is a no-op when there's nothing to migrate", () => {
    const nodes = [concat("c1")];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", sourceHandle: "out", target: "c1", targetHandle: "clip-0" },
    ];
    const out = migrateVideoConcatClips(nodes, edges);
    expect(out.edges).toBe(edges);
    expect(out.nodes).toBe(nodes);
  });

  it("ignores graphs without a video-concat node", () => {
    const nodes: NodeInstance[] = [
      { id: "t", kind: "text", position: { x: 0, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [];
    const out = migrateVideoConcatClips(nodes, edges);
    expect(out.nodes).toBe(nodes);
  });
});

describe("migrateSeedanceRefHandles", () => {
  const seedance = (id: string): NodeInstance => ({
    id,
    kind: "seedance-video",
    position: { x: 0, y: 0 },
    config: {},
  });

  it("spreads legacy image/video/audio edges into numbered sockets per type", () => {
    const nodes = [seedance("s1")];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", sourceHandle: "out", target: "s1", targetHandle: "image" },
      { id: "e2", source: "b", sourceHandle: "out", target: "s1", targetHandle: "image" },
      { id: "e3", source: "c", sourceHandle: "out", target: "s1", targetHandle: "video" },
      { id: "e4", source: "d", sourceHandle: "out", target: "s1", targetHandle: "audio" },
    ];
    const out = migrateSeedanceRefHandles(nodes, edges);
    expect(out.edges.map((e) => e.targetHandle)).toEqual([
      "image-0",
      "image-1",
      "video-0",
      "audio-0",
    ]);
    const cfg = out.nodes[0]!.config as {
      imagePorts: number;
      videoPorts: number;
      audioPorts: number;
    };
    expect(cfg.imagePorts).toBe(2);
    expect(cfg.videoPorts).toBe(1);
    expect(cfg.audioPorts).toBe(1);
  });

  it("is a no-op for graphs with no legacy seedance handles", () => {
    const nodes = [seedance("s1")];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", sourceHandle: "out", target: "s1", targetHandle: "image-0" },
    ];
    const out = migrateSeedanceRefHandles(nodes, edges);
    expect(out.edges).toBe(edges);
  });
});

describe("migrateLlmTextSmartInputs", () => {
  const llm = (id: string): NodeInstance => ({
    id,
    kind: "llm-text",
    position: { x: 0, y: 0 },
    config: { model: "openai/gpt-5" },
  });

  it("spreads legacy `user` + `image` edges into numbered sockets per type", () => {
    const nodes = [llm("l1")];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", sourceHandle: "out", target: "l1", targetHandle: "user" },
      { id: "e2", source: "b", sourceHandle: "out", target: "l1", targetHandle: "user" },
      { id: "e3", source: "c", sourceHandle: "out", target: "l1", targetHandle: "image" },
      { id: "e4", source: "d", sourceHandle: "out", target: "l1", targetHandle: "system" },
    ];
    const out = migrateLlmTextSmartInputs(nodes, edges);
    // user-0 / user-1 / image-0; `system` is intentionally untouched
    // (single-port handle that didn't change shape).
    expect(out.edges.map((e) => e.targetHandle)).toEqual([
      "user-0",
      "user-1",
      "image-0",
      "system",
    ]);
    const cfg = out.nodes[0]!.config as {
      userPorts?: number;
      imagePorts?: number;
    };
    expect(cfg.userPorts).toBe(2);
    expect(cfg.imagePorts).toBe(1);
  });

  it("is a no-op for graphs with no legacy LLM Text handles", () => {
    const nodes = [llm("l1")];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", sourceHandle: "out", target: "l1", targetHandle: "user-0" },
    ];
    const out = migrateLlmTextSmartInputs(nodes, edges);
    expect(out.edges).toBe(edges);
  });

  it("ignores graphs without an llm-text node", () => {
    const nodes: NodeInstance[] = [
      { id: "t", kind: "text", position: { x: 0, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", sourceHandle: "out", target: "t", targetHandle: "user" },
    ];
    const out = migrateLlmTextSmartInputs(nodes, edges);
    // `user` here is a different node's handle, not LLM Text — pass through.
    expect(out.edges).toBe(edges);
  });

  it("caps user / image edges at the per-type ceiling and leaves overflow edges untouched", () => {
    const nodes = [llm("l1")];
    const overflow: WorkflowEdge[] = Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      source: `s${i}`,
      sourceHandle: "out",
      target: "l1",
      targetHandle: "user" as const,
    }));
    const out = migrateLlmTextSmartInputs(nodes, overflow);
    // First 8 (cap) get rewritten; the remainder stay as the legacy id so a
    // future cleanup can decide what to do with them (we never silently
    // drop user data).
    expect(out.edges.slice(0, 8).map((e) => e.targetHandle)).toEqual(
      Array.from({ length: 8 }, (_, i) => `user-${i}`),
    );
    expect(out.edges.slice(8).every((e) => e.targetHandle === "user")).toBe(
      true,
    );
    expect((out.nodes[0]!.config as { userPorts?: number }).userPorts).toBe(8);
  });
});

describe("migrateFalImageSmartInputs", () => {
  const fal = (id: string, model?: string): NodeInstance => ({
    id,
    kind: "fal-image",
    position: { x: 0, y: 0 },
    config: model ? { model } : {},
  });

  it("spreads legacy `image` edges into numbered image-N sockets", () => {
    const nodes = [fal("f1")];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", sourceHandle: "out", target: "f1", targetHandle: "image" },
      { id: "e2", source: "b", sourceHandle: "out", target: "f1", targetHandle: "image" },
      { id: "e3", source: "c", sourceHandle: "out", target: "f1", targetHandle: "image" },
    ];
    const out = migrateFalImageSmartInputs(nodes, edges);
    expect(out.edges.map((e) => e.targetHandle)).toEqual([
      "image-0",
      "image-1",
      "image-2",
    ]);
    const cfg = out.nodes[0]!.config as { imagePorts?: number };
    // 3 migrated edges + 1 trailing empty slot = 4 ports
    expect(cfg.imagePorts).toBe(4);
  });

  it("caps migrated edges at the per-model max (Flux 2 Pro = 8)", () => {
    const nodes = [fal("f1", "flux-2-pro")];
    const edges: WorkflowEdge[] = Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      source: `s${i}`,
      sourceHandle: "out",
      target: "f1",
      targetHandle: "image" as const,
    }));
    const out = migrateFalImageSmartInputs(nodes, edges);
    // First 8 get rewritten; the rest stay legacy `image` (engine ignores).
    expect(out.edges.slice(0, 8).map((e) => e.targetHandle)).toEqual(
      Array.from({ length: 8 }, (_, i) => `image-${i}`),
    );
    expect(out.edges.slice(8).every((e) => e.targetHandle === "image")).toBe(
      true,
    );
    // imagePorts capped at the model's max (8) even though count+1 = 13.
    expect((out.nodes[0]!.config as { imagePorts?: number }).imagePorts).toBe(8);
  });

  it("uses the per-node model to set the cap (Nano Banana 2 = 14)", () => {
    const nodes = [fal("f1", "nano-banana-2")];
    const edges: WorkflowEdge[] = Array.from({ length: 14 }, (_, i) => ({
      id: `e${i}`,
      source: `s${i}`,
      sourceHandle: "out",
      target: "f1",
      targetHandle: "image" as const,
    }));
    const out = migrateFalImageSmartInputs(nodes, edges);
    // All 14 fit within Nano Banana's cap.
    expect(out.edges.every((e) => /^image-\d+$/.test(e.targetHandle!))).toBe(
      true,
    );
    expect((out.nodes[0]!.config as { imagePorts?: number }).imagePorts).toBe(
      14,
    );
  });

  it("falls back to the default model's cap when config.model is unknown", () => {
    const nodes = [fal("f1", "unknown-model-id")];
    const edges: WorkflowEdge[] = Array.from({ length: 16 }, (_, i) => ({
      id: `e${i}`,
      source: `s${i}`,
      sourceHandle: "out",
      target: "f1",
      targetHandle: "image" as const,
    }));
    const out = migrateFalImageSmartInputs(nodes, edges);
    // Default fallback is nano-banana-2 (cap 14) — first 14 rewritten.
    expect(out.edges.slice(0, 14).every((e) =>
      /^image-\d+$/.test(e.targetHandle!),
    )).toBe(true);
    expect(out.edges.slice(14).every((e) => e.targetHandle === "image")).toBe(
      true,
    );
  });

  it("is a no-op when there's nothing to migrate", () => {
    const nodes = [fal("f1")];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", sourceHandle: "out", target: "f1", targetHandle: "image-0" },
    ];
    const out = migrateFalImageSmartInputs(nodes, edges);
    expect(out.edges).toBe(edges);
    expect(out.nodes).toBe(nodes);
  });

  it("ignores graphs without a fal-image node", () => {
    const nodes: NodeInstance[] = [
      { id: "t", kind: "text", position: { x: 0, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", sourceHandle: "out", target: "t", targetHandle: "image" },
    ];
    const out = migrateFalImageSmartInputs(nodes, edges);
    expect(out.edges).toBe(edges);
  });
});

describe("migrateLlmTextCollapseUserPorts (v14 — single-user rollback)", () => {
  const llm = (
    id: string,
    extraConfig: Record<string, unknown> = {},
  ): NodeInstance => ({
    id,
    kind: "llm-text",
    position: { x: 0, y: 0 },
    config: { model: "openai/gpt-5", ...extraConfig },
  });

  it("collapses `user-N` smart-input edges back to a single `user`", () => {
    const nodes = [llm("l1", { userPorts: 3 })];
    const edges: WorkflowEdge[] = [
      // Lowest index wins; the rest get dropped (with a stale userPorts
      // strip on the node config so persisted projects don't carry the
      // dead field forever).
      { id: "e0", source: "a", sourceHandle: "out", target: "l1", targetHandle: "user-0" },
      { id: "e1", source: "b", sourceHandle: "out", target: "l1", targetHandle: "user-1" },
      { id: "e2", source: "c", sourceHandle: "out", target: "l1", targetHandle: "user-2" },
    ];
    const out = migrateLlmTextCollapseUserPorts(nodes, edges);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]!.id).toBe("e0");
    expect(out.edges[0]!.targetHandle).toBe("user");
    // userPorts gets stripped — the field is meaningless under the
    // single-user schema and lingering on persisted projects is just cruft.
    expect(out.nodes[0]!.config).toEqual({ model: "openai/gpt-5" });
  });

  it("treats legacy `user` (multi) the same way — picks the first encountered, drops the rest", () => {
    const nodes = [llm("l1")];
    const edges: WorkflowEdge[] = [
      // Same-rank ties broken by encounter order (Map.set semantics).
      { id: "e0", source: "a", sourceHandle: "out", target: "l1", targetHandle: "user" },
      { id: "e1", source: "b", sourceHandle: "out", target: "l1", targetHandle: "user" },
    ];
    const out = migrateLlmTextCollapseUserPorts(nodes, edges);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]!.id).toBe("e0");
    expect(out.edges[0]!.targetHandle).toBe("user");
  });

  it("`user` (legacy multi) wins over `user-N` when both are present", () => {
    // This is a defensive case — a v11 canvas + a hand-edited v12-style
    // edge co-existing. We rank `user`=0 < `user-0`=1 so the legacy edge
    // wins and the numbered ones drop.
    const nodes = [llm("l1")];
    const edges: WorkflowEdge[] = [
      { id: "e0", source: "a", sourceHandle: "out", target: "l1", targetHandle: "user-0" },
      { id: "e1", source: "b", sourceHandle: "out", target: "l1", targetHandle: "user" },
    ];
    const out = migrateLlmTextCollapseUserPorts(nodes, edges);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]!.id).toBe("e1");
    expect(out.edges[0]!.targetHandle).toBe("user");
  });

  it("leaves system + image-N edges alone (only touches user-related handles)", () => {
    const nodes = [llm("l1")];
    const edges: WorkflowEdge[] = [
      { id: "e0", source: "a", sourceHandle: "out", target: "l1", targetHandle: "user-0" },
      { id: "e1", source: "b", sourceHandle: "out", target: "l1", targetHandle: "system" },
      { id: "e2", source: "c", sourceHandle: "out", target: "l1", targetHandle: "image-0" },
      { id: "e3", source: "d", sourceHandle: "out", target: "l1", targetHandle: "image-1" },
    ];
    const out = migrateLlmTextCollapseUserPorts(nodes, edges);
    expect(out.edges.map((e) => e.targetHandle)).toEqual([
      "user",
      "system",
      "image-0",
      "image-1",
    ]);
  });

  it("strips stale `userPorts` even when there are no user edges to rewrite", () => {
    const nodes = [llm("l1", { userPorts: 4, imagePorts: 2 })];
    const edges: WorkflowEdge[] = [
      { id: "e0", source: "a", sourceHandle: "out", target: "l1", targetHandle: "image-0" },
    ];
    const out = migrateLlmTextCollapseUserPorts(nodes, edges);
    // Edges untouched — only the config got cleaned.
    expect(out.edges).toEqual(edges);
    expect(out.nodes[0]!.config).toEqual({
      model: "openai/gpt-5",
      imagePorts: 2,
    });
  });

  it("is a no-op for graphs with no llm-text node", () => {
    const nodes: NodeInstance[] = [
      { id: "t", kind: "text", position: { x: 0, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "a", sourceHandle: "out", target: "t", targetHandle: "user" },
    ];
    const out = migrateLlmTextCollapseUserPorts(nodes, edges);
    expect(out.edges).toBe(edges);
    expect(out.nodes).toBe(nodes);
  });

  it("is a no-op when the llm-text already has the post-rollback shape", () => {
    const nodes = [llm("l1")];
    const edges: WorkflowEdge[] = [
      { id: "e0", source: "a", sourceHandle: "out", target: "l1", targetHandle: "user" },
      { id: "e1", source: "b", sourceHandle: "out", target: "l1", targetHandle: "system" },
    ];
    const out = migrateLlmTextCollapseUserPorts(nodes, edges);
    expect(out.edges).toBe(edges);
    expect(out.nodes).toBe(nodes);
  });
});

describe("migrateFalImageModelNormalization", () => {
  const falImage = (
    id: string,
    config: Record<string, unknown> = {},
  ): NodeInstance => ({
    id,
    kind: "fal-image",
    position: { x: 0, y: 0 },
    config,
  });

  it("strips the `fal-ai/` prefix when the suffix is a known model", () => {
    const nodes = [falImage("f1", { model: "fal-ai/nano-banana-2", seed: 7 })];
    const out = migrateFalImageModelNormalization(nodes, []);
    expect((out.nodes[0]!.config as { model: string }).model).toBe(
      "nano-banana-2",
    );
    // Non-model fields stay put.
    expect((out.nodes[0]!.config as { seed: number }).seed).toBe(7);
  });

  it("falls back to the default model for an unknown value", () => {
    const nodes = [falImage("f1", { model: "totally-fake-model" })];
    const out = migrateFalImageModelNormalization(nodes, []);
    expect((out.nodes[0]!.config as { model: string }).model).toBe(
      "nano-banana-2",
    );
  });

  it("falls back to the default model when `config.model` is missing", () => {
    const nodes = [falImage("f1", { seed: 1 })];
    const out = migrateFalImageModelNormalization(nodes, []);
    expect((out.nodes[0]!.config as { model: string }).model).toBe(
      "nano-banana-2",
    );
  });

  it("is a no-op when every fal-image already has a known model", () => {
    const nodes = [
      falImage("f1", { model: "nano-banana-2" }),
      falImage("f2", { model: "flux-2-pro" }),
    ];
    const edges: WorkflowEdge[] = [];
    const out = migrateFalImageModelNormalization(nodes, edges);
    expect(out.nodes).toBe(nodes);
    expect(out.edges).toBe(edges);
  });

  it("ignores nodes of other kinds", () => {
    const nodes: NodeInstance[] = [
      falImage("f1", { model: "fal-ai/nano-banana-2" }),
      { id: "t", kind: "text", position: { x: 0, y: 0 }, config: {} },
    ];
    const out = migrateFalImageModelNormalization(nodes, []);
    expect((out.nodes[0]!.config as { model: string }).model).toBe(
      "nano-banana-2",
    );
    // The text node passes through unchanged.
    expect(out.nodes[1]).toBe(nodes[1]);
  });
});

describe("migrateArrayLegacyDelimiter", () => {
  const arrayNode = (
    id: string,
    config: Record<string, unknown> = {},
  ): NodeInstance => ({
    id,
    kind: "array",
    position: { x: 0, y: 0 },
    config,
  });

  it("copies separator into delimiter when delimiter is the default ','", () => {
    const nodes = [
      arrayNode("a1", { trim: true, delimiter: ",", separator: "**" }),
    ];
    const out = migrateArrayLegacyDelimiter(nodes, []);
    expect(out.nodes[0]!.config).toEqual({ trim: true, delimiter: "**" });
  });

  it("copies separator into delimiter when delimiter is unset entirely", () => {
    const nodes = [arrayNode("a1", { trim: true, separator: "---" })];
    const out = migrateArrayLegacyDelimiter(nodes, []);
    expect(out.nodes[0]!.config).toEqual({ trim: true, delimiter: "---" });
  });

  it("preserves an explicitly-set delimiter and only drops the phantom separator", () => {
    // User explicitly chose `delimiter: "|"`. Even if a phantom
    // separator slipped in alongside it, we don't second-guess the
    // user — the separator gets dropped silently, the delimiter stays.
    const nodes = [
      arrayNode("a1", { trim: true, delimiter: "|", separator: "**" }),
    ];
    const out = migrateArrayLegacyDelimiter(nodes, []);
    expect(out.nodes[0]!.config).toEqual({ trim: true, delimiter: "|" });
  });

  it("drops a non-string / empty separator without touching delimiter", () => {
    const nodes = [
      arrayNode("a1", { trim: true, delimiter: ",", separator: "" }),
    ];
    const out = migrateArrayLegacyDelimiter(nodes, []);
    expect(out.nodes[0]!.config).toEqual({ trim: true, delimiter: "," });
  });

  it("is a no-op when no array carries a separator field", () => {
    const nodes = [arrayNode("a1", { trim: true, delimiter: "," })];
    const edges: WorkflowEdge[] = [];
    const out = migrateArrayLegacyDelimiter(nodes, edges);
    expect(out.nodes).toBe(nodes);
    expect(out.edges).toBe(edges);
  });

  it("ignores nodes of other kinds", () => {
    const nodes: NodeInstance[] = [
      arrayNode("a1", { trim: true, delimiter: ",", separator: "**" }),
      {
        id: "t",
        kind: "text",
        position: { x: 0, y: 0 },
        config: { separator: "should-stay" }, // text node is free to use whatever
      },
    ];
    const out = migrateArrayLegacyDelimiter(nodes, []);
    expect(out.nodes[0]!.config).toEqual({ trim: true, delimiter: "**" });
    // Text node config untouched — separator is meaningful only on array.
    expect(out.nodes[1]).toBe(nodes[1]);
  });
});

