import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/engine/all-nodes";
import { handleAssetDrop } from "@/lib/library/handle-asset-drop";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { AssetGroupAsset, ImageAsset } from "@/types/asset";

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  useAssetStore.getState().clear();
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

afterEach(() => {
  useAssetStore.getState().clear();
  useWorkflowStore.setState({ nodes: [], edges: [] });
});

function seedImage(id: string, url = `https://x/${id}.png`): ImageAsset {
  const asset: ImageAsset = {
    id,
    name: id,
    tags: [],
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    kind: "image",
    source: { type: "url", url },
  };
  useAssetStore.setState((s) => ({ ...s, assets: [...s.assets, asset] }));
  return asset;
}

function seedGroup(
  id: string,
  name: string,
  assetIds: string[],
): AssetGroupAsset {
  const group: AssetGroupAsset = {
    id,
    name,
    tags: [],
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    kind: "asset-group",
    assetIds,
    isUntitled: false,
  };
  useAssetStore.setState((s) => ({ ...s, assets: [...s.assets, group] }));
  return group;
}

describe("handleAssetDrop (Slice 5.6.1, extracted from canvas-flow)", () => {
  it("1 image, empty canvas → spawns 1 Image node", () => {
    seedImage("a-1");
    handleAssetDrop({
      payload: { assetIds: ["a-1"], kind: "image" },
      position: { x: 100, y: 200 },
    });
    const nodes = useWorkflowStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind).toBe("image");
    const cfg = nodes[0]?.config as { assetId?: string; url?: string };
    expect(cfg.assetId).toBe("a-1");
    // Position from the helper.
    expect(nodes[0]?.position).toEqual({ x: 100, y: 200 });
  });

  it("group dropped on canvas → spawns image-iterator linked to it", () => {
    seedImage("a-1");
    seedImage("a-2");
    seedGroup("g-paris", "Paris", ["a-1", "a-2"]);
    handleAssetDrop({
      payload: { assetIds: ["g-paris"], kind: "asset-group" },
      position: { x: 50, y: 50 },
    });
    const nodes = useWorkflowStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind).toBe("image-iterator");
    expect((nodes[0]?.config as { groupId?: string }).groupId).toBe(
      "g-paris",
    );
  });

  it("image dropped on existing iterator → addToGroup on its linked group", () => {
    seedImage("a-1");
    seedImage("a-2");
    seedGroup("g-1", "G", ["a-1"]);
    useWorkflowStore.setState({
      nodes: [
        {
          id: "iter-1",
          kind: "image-iterator",
          position: { x: 0, y: 0 },
          config: { groupId: "g-1", cursor: 0, selectionMode: "all" },
        },
      ],
      edges: [],
    });

    handleAssetDrop({
      payload: { assetIds: ["a-2"], kind: "image" },
      target: {
        nodeId: "iter-1",
        nodeKind: "image-iterator",
        iteratorGroupId: "g-1",
      },
      position: { x: 0, y: 0 },
    });

    // Group has both assetIds now, in order.
    const group = useAssetStore.getState().getAsset("g-1") as AssetGroupAsset;
    expect(group.assetIds).toEqual(["a-1", "a-2"]);
    // No new node spawned.
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
  });

  it("group dropped on iterator → expands @group sentinel via asset store + addToGroup", () => {
    seedImage("a-1");
    seedImage("a-2");
    seedImage("a-3");
    seedGroup("g-source", "Source", ["a-2", "a-3"]);
    seedGroup("g-target", "Target", ["a-1"]);
    useWorkflowStore.setState({
      nodes: [
        {
          id: "iter-1",
          kind: "image-iterator",
          position: { x: 0, y: 0 },
          config: { groupId: "g-target", cursor: 0, selectionMode: "all" },
        },
      ],
      edges: [],
    });

    handleAssetDrop({
      payload: { assetIds: ["g-source"], kind: "asset-group" },
      target: {
        nodeId: "iter-1",
        nodeKind: "image-iterator",
        iteratorGroupId: "g-target",
      },
      position: { x: 0, y: 0 },
    });

    // Target group now has all 3 ids in order; source group untouched.
    const target = useAssetStore.getState().getAsset("g-target") as AssetGroupAsset;
    expect(target.assetIds).toEqual(["a-1", "a-2", "a-3"]);
    const source = useAssetStore
      .getState()
      .getAsset("g-source") as AssetGroupAsset;
    expect(source.assetIds).toEqual(["a-2", "a-3"]);
  });

  it("empty payload → no-op (no nodes spawned, no group writes)", () => {
    const before = useWorkflowStore.getState().nodes.length;
    handleAssetDrop({
      payload: { assetIds: [], kind: "image" },
      position: { x: 0, y: 0 },
    });
    expect(useWorkflowStore.getState().nodes.length).toBe(before);
    expect(useAssetStore.getState().assets).toEqual([]);
  });
});
