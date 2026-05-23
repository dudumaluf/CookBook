import { describe, expect, it } from "vitest";

import { assetToNode } from "@/lib/library/asset-to-node";
import type { AssetGroupAsset, ImageAsset } from "@/types/asset";

function makeAsset(source: ImageAsset["source"]): ImageAsset {
  return {
    id: "asset_xyz",
    kind: "image",
    name: "Cat",
    tags: [],
    scope: "project",
    createdAt: 1,
    updatedAt: 1,
    source,
  };
}

describe("assetToNode", () => {
  it("URL-source image → spawns Image node with url + assetId baked in", () => {
    const asset = makeAsset({
      type: "url",
      url: "https://example.com/cat.jpg",
    });
    expect(assetToNode(asset)).toEqual({
      kind: "image",
      initialConfig: {
        assetId: asset.id,
        url: "https://example.com/cat.jpg",
      },
    });
  });

  it("Remote-source image → spawns Image node with the Supabase CDN url baked in", () => {
    const asset = makeAsset({
      type: "remote",
      bucket: "cookbook-assets",
      key: "images/abc/cat.png",
      url: "https://cdn.supabase.test/cookbook-assets/images/abc/cat.png",
      mime: "image/png",
      sizeBytes: 1234,
    });
    expect(assetToNode(asset)).toEqual({
      kind: "image",
      initialConfig: {
        assetId: asset.id,
        url: "https://cdn.supabase.test/cookbook-assets/images/abc/cat.png",
      },
    });
  });

  it("AssetGroup → spawns image-iterator linked via groupId (Slice 5.6 / ADR-0032)", () => {
    const group: AssetGroupAsset = {
      id: "g-photo-paris",
      kind: "asset-group",
      name: "Photoshoot Paris",
      tags: [],
      scope: "project",
      createdAt: 1,
      updatedAt: 1,
      assetIds: ["a-1", "a-2", "a-3"],
      isUntitled: false,
    };
    expect(assetToNode(group)).toEqual({
      kind: "image-iterator",
      initialConfig: {
        groupId: group.id,
        cursor: 0,
        selectionMode: "all",
      },
    });
  });
});
