import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AssetCard } from "@/components/library/asset-card";
import {
  ASSET_DRAG_MIME,
  parseAssetDrag,
} from "@/lib/library/asset-drag";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { ImageAsset } from "@/types/asset";

const asset: ImageAsset = {
  id: "asset_test",
  kind: "image",
  name: "Test image",
  url: "https://example.com/test.jpg",
  tags: [],
  scope: "project",
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  useAssetStore.getState().clear();
  // Seed the store so removeAsset has something to act on.
  useAssetStore.setState({ assets: [asset] });
});

describe("<AssetCard />", () => {
  it("renders the thumbnail (alt = asset name) and the asset name label", () => {
    render(<AssetCard asset={asset} />);
    const img = screen.getByAltText("Test image") as HTMLImageElement;
    expect(img.src).toBe(asset.url);
    expect(screen.getByText("Test image")).toBeTruthy();
  });

  it("setData on drag start uses our custom MIME and a valid payload", () => {
    render(<AssetCard asset={asset} />);
    const card = screen.getByTitle("Test image");

    const setData = vi.fn();
    fireEvent.dragStart(card, {
      dataTransfer: { setData, effectAllowed: "" },
    });

    expect(setData).toHaveBeenCalledTimes(1);
    const [mime, payload] = setData.mock.calls[0]!;
    expect(mime).toBe(ASSET_DRAG_MIME);
    expect(parseAssetDrag(payload as string)).toEqual({
      assetId: asset.id,
      kind: "image",
    });
  });

  it("Delete button removes the asset from the store", () => {
    render(<AssetCard asset={asset} />);
    const btn = screen.getByLabelText("Delete asset Test image");
    fireEvent.click(btn);
    expect(useAssetStore.getState().getAsset(asset.id)).toBeUndefined();
  });
});
