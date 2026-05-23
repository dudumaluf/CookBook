import { describe, expect, it } from "vitest";

import { dispatchAssetDrop } from "@/lib/library/dispatch-asset-drop";

describe("dispatchAssetDrop", () => {
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

  it("1 image, dropped on an existing Image Iterator → append to its assetIds", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["a-1"], kind: "image" },
      target: { nodeId: "iter-1", nodeKind: "image-iterator" },
    });
    expect(actions).toEqual([
      {
        type: "append-to-iterator",
        iteratorId: "iter-1",
        assetIds: ["a-1"],
      },
    ]);
  });

  /* ──────────────────────────── N images ─────────────────────────── */

  it("N images, empty canvas → spawn one Image Iterator pre-populated", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["a-1", "a-2", "a-3"], kind: "image" },
    });
    expect(actions).toEqual([
      {
        type: "spawn-node",
        kind: "image-iterator",
        initialConfig: {
          assetIds: ["a-1", "a-2", "a-3"],
          cursor: 0,
          selectionMode: "all",
        },
      },
    ]);
  });

  it("N images, dropped on existing iterator → append all to it", () => {
    const actions = dispatchAssetDrop({
      payload: { assetIds: ["a-1", "a-2"], kind: "image" },
      target: { nodeId: "iter-1", nodeKind: "image-iterator" },
    });
    expect(actions).toEqual([
      {
        type: "append-to-iterator",
        iteratorId: "iter-1",
        assetIds: ["a-1", "a-2"],
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
