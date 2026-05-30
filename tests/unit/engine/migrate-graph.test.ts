import { describe, expect, it } from "vitest";

import { migrateVideoConcatClips } from "@/lib/engine/migrate-graph";
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
