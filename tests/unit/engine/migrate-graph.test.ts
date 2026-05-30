import { describe, expect, it } from "vitest";

import {
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
