import { describe, expect, it } from "vitest";

import { assetMedia, assetToReference, assetUrl } from "@/lib/library/attach-file";
import type { AssetGroupAsset, ImageAsset, SoulIdAsset } from "@/types/asset";

const image: ImageAsset = {
  id: "asset_img",
  kind: "image",
  name: "Cat",
  tags: [],
  scope: "project",
  createdAt: 0,
  updatedAt: 0,
  source: { type: "url", url: "https://x/cat.png" },
};

const soul: SoulIdAsset = {
  id: "asset_soul",
  kind: "soul-id",
  name: "Alice",
  tags: [],
  scope: "global",
  createdAt: 0,
  updatedAt: 0,
  customReferenceId: "ref-1",
  variant: "v2",
  thumbnailUrl: "https://x/alice.png",
};

const group: AssetGroupAsset = {
  id: "asset_grp",
  kind: "asset-group",
  name: "Set",
  tags: [],
  scope: "project",
  createdAt: 0,
  updatedAt: 0,
  assetIds: ["a", "b"],
  isUntitled: false,
};

describe("assetMedia", () => {
  it("maps asset kinds to prompt-reference media types", () => {
    expect(assetMedia("image")).toBe("image");
    expect(assetMedia("video")).toBe("video");
    expect(assetMedia("audio")).toBe("audio");
    expect(assetMedia("soul-id")).toBe("soul-id");
    expect(assetMedia("asset-group")).toBe("group");
  });
});

describe("assetUrl", () => {
  it("reads the source url for media, thumbnail for soul-id, none for groups", () => {
    expect(assetUrl(image)).toBe("https://x/cat.png");
    expect(assetUrl(soul)).toBe("https://x/alice.png");
    expect(assetUrl(group)).toBeUndefined();
  });
});

describe("assetToReference", () => {
  it("builds an asset-kind reference chip", () => {
    const ref = assetToReference(image);
    expect(ref.kind).toBe("asset");
    expect(ref.refId).toBe("asset_img");
    expect(ref.label).toBe("Cat");
    expect(ref.mediaType).toBe("image");
    expect(ref.url).toBe("https://x/cat.png");
  });

  it("omits url for a group reference", () => {
    const ref = assetToReference(group);
    expect(ref.mediaType).toBe("group");
    expect(ref.url).toBeUndefined();
  });
});
