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

  it("setData on drag start uses our custom MIME and the new multi-id payload shape", () => {
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
    // Slice 5.5c: payload is { assetIds: [id], kind } even for a 1-asset
    // drag — keeps the parser shape uniform.
    expect(parseAssetDrag(payload as string)).toEqual({
      assetIds: [urlAsset.id],
      kind: "image",
    });
  });

  /* ──────────────────── Slice 5.5c: multi-select + drag ──────────────── */

  describe("multi-select", () => {
    const second: ImageAsset = {
      ...urlAsset,
      id: "asset_second",
      name: "Second Cat",
      source: { type: "url", url: "https://example.com/cat2.jpg" },
    };
    const third: ImageAsset = {
      ...urlAsset,
      id: "asset_third",
      name: "Third Cat",
      source: { type: "url", url: "https://example.com/cat3.jpg" },
    };

    it("plain click sets the selection to just this card", () => {
      useAssetStore.setState({ assets: [urlAsset, second] });
      render(<AssetCard asset={urlAsset} />);
      fireEvent.click(screen.getByTitle("URL Cat"));
      expect(useAssetStore.getState().selectedAssetIds).toEqual([urlAsset.id]);
    });

    it("cmd/ctrl-click toggles this card's membership in the selection", () => {
      useAssetStore.setState({ assets: [urlAsset, second] });
      render(<AssetCard asset={urlAsset} />);
      const card = screen.getByTitle("URL Cat");

      // First cmd-click adds.
      fireEvent.click(card, { metaKey: true });
      expect(useAssetStore.getState().selectedAssetIds).toEqual([urlAsset.id]);

      // Second cmd-click removes.
      fireEvent.click(card, { metaKey: true });
      expect(useAssetStore.getState().selectedAssetIds).toEqual([]);
    });

    it("shift-click range-selects from the anchor through this card", () => {
      useAssetStore.setState({ assets: [urlAsset, second, third] });
      // Render the third one alone — but click anchor is set on the
      // *first* via a plain click into the store's API directly (we
      // don't need the AssetCard for that since selectAsset is the
      // store action).
      useAssetStore.getState().selectAsset(urlAsset.id);
      render(<AssetCard asset={third} />);
      fireEvent.click(screen.getByTitle("Third Cat"), { shiftKey: true });
      // Range from urlAsset (idx 0) to third (idx 2) inclusive.
      expect(useAssetStore.getState().selectedAssetIds).toEqual([
        urlAsset.id,
        second.id,
        third.id,
      ]);
    });

    it("dragging a card that's part of the selection ships ALL selected ids in the payload", () => {
      useAssetStore.setState({ assets: [urlAsset, second, third] });
      // Pre-select two of three.
      useAssetStore.setState({
        selectedAssetIds: [urlAsset.id, third.id],
        selectionAnchorId: third.id,
      });
      render(<AssetCard asset={urlAsset} />);
      const setData = vi.fn();
      fireEvent.dragStart(screen.getByTitle("URL Cat"), {
        dataTransfer: { setData, effectAllowed: "" },
      });
      const [, payload] = setData.mock.calls[0]!;
      expect(parseAssetDrag(payload as string)).toEqual({
        assetIds: [urlAsset.id, third.id],
        kind: "image",
      });
    });

    it("dragging an UNSELECTED card resets selection to it and ships only its id", () => {
      // Matches Finder: dragging an unselected file first selects it.
      useAssetStore.setState({ assets: [urlAsset, second] });
      useAssetStore.setState({
        selectedAssetIds: [second.id],
        selectionAnchorId: second.id,
      });
      render(<AssetCard asset={urlAsset} />);
      const setData = vi.fn();
      fireEvent.dragStart(screen.getByTitle("URL Cat"), {
        dataTransfer: { setData, effectAllowed: "" },
      });
      const [, payload] = setData.mock.calls[0]!;
      expect(parseAssetDrag(payload as string)).toEqual({
        assetIds: [urlAsset.id],
        kind: "image",
      });
      // Selection state was reset to just the dragged card.
      expect(useAssetStore.getState().selectedAssetIds).toEqual([urlAsset.id]);
    });

    it("renders a visible 'selected' state (via data-selected + accent border)", () => {
      useAssetStore.setState({ assets: [urlAsset] });
      useAssetStore.setState({
        selectedAssetIds: [urlAsset.id],
        selectionAnchorId: urlAsset.id,
      });
      render(<AssetCard asset={urlAsset} />);
      const card = screen.getByTestId("asset-card");
      expect(card.getAttribute("data-selected")).toBe("true");
      expect(card.className).toMatch(/border-accent/);
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
