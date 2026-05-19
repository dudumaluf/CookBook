import { describe, expect, it } from "vitest";

import { assetToNode } from "@/lib/library/asset-to-node";
import type { ImageAsset } from "@/types/asset";

describe("assetToNode", () => {
  it("maps an Image asset to an Image node with url + assetId baked in", () => {
    const asset: ImageAsset = {
      id: "asset_xyz",
      kind: "image",
      name: "Cat",
      url: "https://example.com/cat.jpg",
      tags: [],
      scope: "project",
      createdAt: 1,
      updatedAt: 1,
    };
    expect(assetToNode(asset)).toEqual({
      kind: "image",
      initialConfig: { url: asset.url, assetId: asset.id },
    });
  });
});
