import { describe, expect, it } from "vitest";

import {
  dedupCascadeRedundantOps,
  dedupExistingAddEdgeOps,
} from "@/lib/assistant/refactor-dedup";
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
 *
 * `dedupExistingAddEdgeOps` — sibling helper that strips `add_edge`
 * ops whose exact wire (source/sourceHandle/target/targetHandle) is
 * already on the canvas.
 */

const edges = [
  {
    id: "src-out-dst-user",
    source: "src",
    target: "dst",
    sourceHandle: "out",
    targetHandle: "user",
  },
  {
    id: "src-out-keep-prompt",
    source: "src",
    target: "keep",
    sourceHandle: "out",
    targetHandle: "prompt",
  },
  {
    id: "stay-out-keep-user",
    source: "stay",
    target: "keep",
    sourceHandle: "out",
    targetHandle: "user",
  },
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

describe("dedupExistingAddEdgeOps", () => {
  it("drops add_edge ops whose exact wire is already on the canvas", () => {
    // 2026-06-02 regression: the assistant proposed a 9-edge "wire up
    // the workflow" batch, but the user had already wired the first
    // two edges manually. Without dedup, op 1 (add_edge from
    // text_a.text → llm_x.user) failed because the target handle was
    // already occupied, rolling the entire batch back. This test
    // asserts the dedup filters those leading duplicates so the
    // remaining ops can run cleanly.
    const ops: RefactorOperation[] = [
      {
        op: "add_edge",
        source: "src",
        sourceHandle: "out",
        target: "dst",
        targetHandle: "user",
      }, // duplicate of src-out-dst-user
      {
        op: "add_edge",
        source: "stay",
        sourceHandle: "out",
        target: "keep",
        targetHandle: "user",
      }, // duplicate of stay-out-keep-user
      {
        op: "add_edge",
        source: "fresh",
        sourceHandle: "out",
        target: "dst",
        targetHandle: "system",
      }, // brand new — keep
    ];
    const { operations, removed } = dedupExistingAddEdgeOps(ops, edges);
    expect(operations).toEqual([
      {
        op: "add_edge",
        source: "fresh",
        sourceHandle: "out",
        target: "dst",
        targetHandle: "system",
      },
    ]);
    expect(removed).toHaveLength(2);
  });

  it("keeps add_edge ops that share endpoints but differ in handles", () => {
    // src→dst exists on `out`/`user`. A new edge between the same node
    // pair on a DIFFERENT handle (e.g. another input port) is not a
    // duplicate — the dedup must let it through.
    const ops: RefactorOperation[] = [
      {
        op: "add_edge",
        source: "src",
        sourceHandle: "out",
        target: "dst",
        targetHandle: "image-0",
      },
    ];
    const { operations, removed } = dedupExistingAddEdgeOps(ops, edges);
    expect(operations).toEqual(ops);
    expect(removed).toEqual([]);
  });

  it("never drops ops that aren't add_edge", () => {
    const ops: RefactorOperation[] = [
      { op: "remove_node", nodeId: "src" },
      { op: "remove_edge", edgeId: "src-out-dst-user" },
      { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
      { op: "update_node_config", nodeId: "src", config: { x: 1 } },
    ];
    const { operations, removed } = dedupExistingAddEdgeOps(ops, edges);
    expect(operations).toEqual(ops);
    expect(removed).toEqual([]);
  });

  it("preserves order across mixed kept + dropped + non-add_edge ops", () => {
    const ops: RefactorOperation[] = [
      { op: "remove_node", nodeId: "phantom" },
      {
        op: "add_edge",
        source: "src",
        sourceHandle: "out",
        target: "dst",
        targetHandle: "user",
      }, // dup → drop
      { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
      {
        op: "add_edge",
        source: "fresh",
        sourceHandle: "out",
        target: "dst",
        targetHandle: "system",
      }, // keep
    ];
    const { operations } = dedupExistingAddEdgeOps(ops, edges);
    expect(operations).toEqual([
      { op: "remove_node", nodeId: "phantom" },
      { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
      {
        op: "add_edge",
        source: "fresh",
        sourceHandle: "out",
        target: "dst",
        targetHandle: "system",
      },
    ]);
  });

  it("returns the input untouched when the snapshot is empty", () => {
    const ops: RefactorOperation[] = [
      {
        op: "add_edge",
        source: "src",
        sourceHandle: "out",
        target: "dst",
        targetHandle: "user",
      },
    ];
    const { operations, removed } = dedupExistingAddEdgeOps(ops, []);
    expect(operations).toEqual(ops);
    expect(removed).toEqual([]);
  });
});
