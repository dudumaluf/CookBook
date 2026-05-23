import { describe, expect, it } from "vitest";

import { dispatchAssetDrop } from "@/lib/library/dispatch-asset-drop";

describe("dispatchAssetDrop (Slice 5.6d, ADR-0032)", () => {
  /* ────────────────────────── Empty payload ────────────────────────── */

  it("returns a noop on an empty assetIds payload (defensive)", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: [], kind: "image" },
    });
    expect(actions).toEqual([{ type: "noop", reason: "empty-payload" }]);
  });

  /* ──────────────────────────── 1 image ──────────────────────────── */

  it("1 image, empty canvas → spawn one Image node", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["a-1"], kind: "image" },
    });
    expect(actions).toEqual([
      {
        type: "spawn-node",
        kind: "image",
        initialConfig: { assetId: "a-1" },
      },
    ]);
  });

  it("1 image, dropped on a non-iterator node → still spawn an Image node", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["a-1"], kind: "image" },
      target: { nodeId: "gen-1", nodeKind: "higgsfield-image-gen" },
    });
    expect(actions).toEqual([
      {
        type: "spawn-node",
        kind: "image",
        initialConfig: { assetId: "a-1" },
      },
    ]);
  });

  it("1 image, dropped on an existing Image Iterator → append-to-group on its linked group", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["a-1"], kind: "image" },
      target: {
        nodeId: "iter-1",
        nodeKind: "image-iterator",
        iteratorGroupId: "g-linked",
      },
    });
    expect(actions).toEqual([
      {
        type: "append-to-group",
        groupId: "g-linked",
        assetIds: ["a-1"],
      },
    ]);
  });

  it("1 image, dropped on a placeholder iterator (groupId=='') → falls through to spawn (caller can convert later)", () => {
    // Placeholder iterators (newly-spawned, not yet linked) don't get
    // the propagate path — there's no group to propagate INTO. The
    // dispatcher falls through to the empty-canvas branch so the
    // user gets a working spawn. The caller may decide to leave the
    // placeholder intact and spawn next to it; today we just spawn.
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["a-1"], kind: "image" },
      target: {
        nodeId: "iter-placeholder",
        nodeKind: "image-iterator",
        iteratorGroupId: "",
      },
    });
    expect(actions).toEqual([
      {
        type: "spawn-node",
        kind: "image",
        initialConfig: { assetId: "a-1" },
      },
    ]);
  });

  /* ──────────────────────────── N images ─────────────────────────── */

  it("N images, empty canvas → create-group-and-spawn-iterator (Untitled)", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["a-1", "a-2", "a-3"], kind: "image" },
    });
    expect(actions).toEqual([
      {
        type: "create-group-and-spawn-iterator",
        assetIds: ["a-1", "a-2", "a-3"],
        isUntitled: true,
      },
    ]);
  });

  it("N images, dropped on existing iterator → append-to-group", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["a-1", "a-2"], kind: "image" },
      target: {
        nodeId: "iter-1",
        nodeKind: "image-iterator",
        iteratorGroupId: "g-linked",
      },
    });
    expect(actions).toEqual([
      {
        type: "append-to-group",
        groupId: "g-linked",
        assetIds: ["a-1", "a-2"],
      },
    ]);
  });

  /* ─────────────────────── AssetGroup payload ─────────────────────── */

  it("group, empty canvas → spawn iterator linked to the group's id", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["g-paris"], kind: "asset-group" },
    });
    expect(actions).toEqual([
      {
        type: "spawn-node",
        kind: "image-iterator",
        initialConfig: {
          groupId: "g-paris",
          cursor: 0,
          selectionMode: "all",
        },
      },
    ]);
  });

  it("group, dropped on a non-iterator node → still spawn an iterator linked to it", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["g-paris"], kind: "asset-group" },
      target: { nodeId: "gen-1", nodeKind: "higgsfield-image-gen" },
    });
    expect(actions[0]).toEqual({
      type: "spawn-node",
      kind: "image-iterator",
      initialConfig: {
        groupId: "g-paris",
        cursor: 0,
        selectionMode: "all",
      },
    });
  });

  it("group, dropped on an existing iterator → append-to-group with @group:<id> sentinel", () => {
    // The dispatcher emits a sentinel; the canvas-flow caller
    // expands it through the asset store before calling addToGroup.
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["g-source"], kind: "asset-group" },
      target: {
        nodeId: "iter-1",
        nodeKind: "image-iterator",
        iteratorGroupId: "g-target",
      },
    });
    expect(actions).toEqual([
      {
        type: "append-to-group",
        groupId: "g-target",
        assetIds: ["@group:g-source"],
      },
    ]);
  });

  /* ─────────────────────────── Soul IDs ────────────────────────────── */

  it("multiple Soul IDs spawn one node per id (no iterator collapsing)", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["s-1", "s-2"], kind: "soul-id" },
    });
    expect(actions).toEqual([
      {
        type: "spawn-node",
        kind: "soul-id",
        initialConfig: { assetId: "s-1" },
      },
      {
        type: "spawn-node",
        kind: "soul-id",
        initialConfig: { assetId: "s-2" },
      },
    ]);
  });

  /* ───────────────────────── Unsupported kind ──────────────────────── */

  it("returns a noop for an unsupported asset kind (defensive — keeps the dispatcher exhaustive)", () => {
    const actions = dispatchAssetDrop({
      // @ts-expect-error — exercising the runtime branch for a kind
      // that doesn't exist in the union.
      payload: { assetIds: ["x"], kind: "video" },
    });
    expect(actions[0]?.type).toBe("noop");
  });
});
