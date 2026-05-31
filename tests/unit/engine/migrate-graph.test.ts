import { describe, expect, it } from "vitest";

import {
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
