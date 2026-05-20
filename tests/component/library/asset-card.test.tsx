import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AssetCard } from "@/components/library/asset-card";
import {
  ASSET_DRAG_MIME,
  parseAssetDrag,
} from "@/lib/library/asset-drag";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { ImageAsset } from "@/types/asset";

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

const urlAsset: ImageAsset = {
  id: "asset_url",
  kind: "image",
  name: "URL Cat",
  tags: [],
  scope: "project",
  createdAt: 1,
  updatedAt: 1,
  source: { type: "url", url: "https://example.com/cat.jpg" },
};

const remoteAsset: ImageAsset = {
  id: "asset_remote",
  kind: "image",
  name: "Uploaded Cat",
  tags: [],
  scope: "project",
  createdAt: 1,
  updatedAt: 1,
  source: {
    type: "remote",
    bucket: "cookbook-assets",
    key: "images/abc/Cat.png",
    url: "https://cdn.supabase.test/cookbook-assets/images/abc/Cat.png",
    mime: "image/png",
    sizeBytes: 1234,
  },
};

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
});

describe("<AssetCard />", () => {
  it("renders the thumbnail for url-source assets directly from source.url", () => {
    useAssetStore.setState({ assets: [urlAsset] });
    render(<AssetCard asset={urlAsset} />);
    const img = screen.getByAltText("URL Cat") as HTMLImageElement;
    expect(img.src).toBe(urlAsset.source.type === "url" ? urlAsset.source.url : "");
    expect(screen.getByText("URL Cat")).toBeTruthy();
  });

  it("renders the thumbnail for remote-source assets from the Supabase CDN url", () => {
    useAssetStore.setState({ assets: [remoteAsset] });
    render(<AssetCard asset={remoteAsset} />);
    const img = screen.getByAltText("Uploaded Cat") as HTMLImageElement;
    expect(img.src).toBe(
      remoteAsset.source.type === "remote" ? remoteAsset.source.url : "",
    );
  });

  it("setData on drag start uses our custom MIME and a valid payload", () => {
    useAssetStore.setState({ assets: [urlAsset] });
    render(<AssetCard asset={urlAsset} />);
    const card = screen.getByTitle("URL Cat");
    const setData = vi.fn();
    fireEvent.dragStart(card, {
      dataTransfer: { setData, effectAllowed: "" },
    });
    expect(setData).toHaveBeenCalledTimes(1);
    const [mime, payload] = setData.mock.calls[0]!;
    expect(mime).toBe(ASSET_DRAG_MIME);
    expect(parseAssetDrag(payload as string)).toEqual({
      assetId: urlAsset.id,
      kind: "image",
    });
  });

  it("Delete button removes the asset from the store", async () => {
    useAssetStore.setState({ assets: [urlAsset] });
    render(<AssetCard asset={urlAsset} />);
    fireEvent.click(screen.getByLabelText("Delete asset URL Cat"));
    await waitFor(() => {
      expect(useAssetStore.getState().getAsset(urlAsset.id)).toBeUndefined();
    });
  });

  it("renders a placeholder when the asset has no thumbnail url", () => {
    const empty: ImageAsset = {
      ...urlAsset,
      id: "asset_empty",
      name: "Empty",
      source: { type: "url", url: "" },
    };
    useAssetStore.setState({ assets: [empty] });
    render(<AssetCard asset={empty} />);
    expect(screen.queryByAltText("Empty")).toBeNull();
  });
});
