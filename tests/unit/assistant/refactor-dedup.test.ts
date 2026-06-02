import { describe, expect, it } from "vitest";

import { dedupCascadeRedundantOps } from "@/lib/assistant/refactor-dedup";
import type { RefactorOperation } from "@/lib/assistant/refactor-types";

/**
 * `dedupCascadeRedundantOps` — pure helper that strips
 * `remove_edge` ops which would already be swept by a prior
 * `remove_node` cascade in the same batch.
 *
 * Verifies:
 *   - redundant remove_edge ops (incident to a removed node) are
 *     dropped,
 *   - non-redundant remove_edge ops (between staying nodes) are
 *     preserved,
 *   - order of the surviving ops is unchanged,
 *   - empty snapshot degrades to a no-op,
 *   - `removed[]` callout matches what was filtered (for log/UX).
 */

const edges = [
  { id: "src-out-dst-user", source: "src", target: "dst" },
  { id: "src-out-keep-prompt", source: "src", target: "keep" },
  { id: "stay-out-keep-user", source: "stay", target: "keep" },
];

describe("dedupCascadeRedundantOps", () => {
  it("drops remove_edge ops incident to a removed node", () => {
    const ops: RefactorOperation[] = [
      { op: "remove_node", nodeId: "src" },
      { op: "remove_edge", edgeId: "src-out-dst-user" },
      { op: "remove_edge", edgeId: "src-out-keep-prompt" },
    ];
    const { operations, removed } = dedupCascadeRedundantOps(ops, edges);
    expect(operations).toEqual([{ op: "remove_node", nodeId: "src" }]);
    expect(removed).toHaveLength(2);
    expect(removed.map((o) => o.edgeId)).toEqual([
      "src-out-dst-user",
      "src-out-keep-prompt",
    ]);
  });

  it("preserves remove_edge ops between staying nodes", () => {
    const ops: RefactorOperation[] = [
      { op: "remove_node", nodeId: "src" },
      { op: "remove_edge", edgeId: "stay-out-keep-user" },
    ];
    const { operations, removed } = dedupCascadeRedundantOps(ops, edges);
    expect(operations).toEqual(ops);
    expect(removed).toEqual([]);
  });

  it("preserves the relative order of surviving ops", () => {
    const ops: RefactorOperation[] = [
      { op: "remove_node", nodeId: "src" },
      { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
      { op: "remove_edge", edgeId: "src-out-dst-user" }, // redundant
      { op: "remove_edge", edgeId: "stay-out-keep-user" }, // keeps
      { op: "add_edge", source: "stay", sourceHandle: "out", target: "x", targetHandle: "y" },
    ];
    const { operations } = dedupCascadeRedundantOps(ops, edges);
    expect(operations).toEqual([
      { op: "remove_node", nodeId: "src" },
      { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
      { op: "remove_edge", edgeId: "stay-out-keep-user" },
      { op: "add_edge", source: "stay", sourceHandle: "out", target: "x", targetHandle: "y" },
    ]);
  });

  it("returns the input untouched when the snapshot is empty", () => {
    const ops: RefactorOperation[] = [
      { op: "remove_node", nodeId: "src" },
      { op: "remove_edge", edgeId: "src-out-dst-user" },
    ];
    const { operations, removed } = dedupCascadeRedundantOps(ops, []);
    expect(operations).toEqual(ops);
    expect(removed).toEqual([]);
  });

  it("never drops ops that aren't remove_edge", () => {
    const ops: RefactorOperation[] = [
      { op: "remove_node", nodeId: "src" },
      { op: "remove_node", nodeId: "dst" },
      { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
      { op: "update_node_config", nodeId: "stay", config: { foo: 1 } },
      { op: "move_node", nodeId: "stay", position: { x: 1, y: 1 } },
    ];
    const { operations, removed } = dedupCascadeRedundantOps(ops, edges);
    expect(operations).toEqual(ops);
    expect(removed).toEqual([]);
  });

  it("only filters edges the proposal would actually cascade", () => {
    // remove_edge for an unknown edge id (not in the snapshot) is left
    // alone — we can't prove redundancy, so we pass it through and let
    // the apply path decide whether to surface or swallow it.
    const ops: RefactorOperation[] = [
      { op: "remove_node", nodeId: "src" },
      { op: "remove_edge", edgeId: "phantom-edge" },
    ];
    const { operations, removed } = dedupCascadeRedundantOps(ops, edges);
    expect(operations).toEqual(ops);
    expect(removed).toEqual([]);
  });
});
