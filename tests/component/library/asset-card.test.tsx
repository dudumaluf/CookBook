import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AssetCard } from "@/components/library/asset-card";
import {
  ASSET_DRAG_MIME,
  parseAssetDrag,
} from "@/lib/library/asset-drag";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { AssetGroupAsset, ImageAsset } from "@/types/asset";

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

  /* ──────────────── Slice 5.6b: AssetGroup card ──────────────── */

  describe("group cards (Slice 5.6b)", () => {
    function makeGroup(
      partial: Partial<AssetGroupAsset> = {},
    ): AssetGroupAsset {
      return {
        id: "group_1",
        kind: "asset-group",
        name: "Photoshoot Paris",
        tags: [],
        scope: "project",
        createdAt: 0,
        updatedAt: 0,
        assetIds: [],
        isUntitled: false,
        ...partial,
      };
    }

    function seedImageAsset(id: string, url: string): ImageAsset {
      return {
        id,
        kind: "image",
        name: id,
        tags: [],
        scope: "project",
        createdAt: 0,
        updatedAt: 0,
        source: { type: "url", url },
      };
    }

    it("renders a 2x2 mosaic of up to 4 image thumbnails + count badge", () => {
      const images = Array.from({ length: 5 }, (_, i) =>
        seedImageAsset(`a-${i}`, `https://x/${i}.png`),
      );
      const group = makeGroup({ assetIds: images.map((a) => a.id) });
      useAssetStore.setState({ assets: [...images, group] });
      const { container } = render(<AssetCard asset={group} />);
      const mosaic = screen.getByTestId("asset-group-mosaic");
      expect(mosaic).toBeInTheDocument();
      // First 4 images render. Use `container.querySelectorAll` since
      // the imgs in the mosaic have empty alt strings.
      const imgs = Array.from(
        container.querySelectorAll('[data-testid="asset-group-mosaic"] img'),
      ) as HTMLImageElement[];
      expect(imgs).toHaveLength(4);
      expect(imgs[0]?.src).toContain("https://x/0.png");
      // Count badge shows total (5).
      expect(
        screen.getByTestId("asset-group-count-badge").textContent,
      ).toBe("5");
    });

    it("shows the Untitled badge for auto-created groups", () => {
      const group = makeGroup({
        name: "Untitled 1",
        isUntitled: true,
      });
      useAssetStore.setState({ assets: [group] });
      render(<AssetCard asset={group} />);
      expect(
        screen.getByTestId("asset-group-untitled-badge"),
      ).toBeInTheDocument();
    });

    it("does NOT show the Untitled badge for renamed groups", () => {
      const group = makeGroup({ name: "Real group", isUntitled: false });
      useAssetStore.setState({ assets: [group] });
      render(<AssetCard asset={group} />);
      expect(
        screen.queryByTestId("asset-group-untitled-badge"),
      ).toBeNull();
    });

    it("double-click on the name commits a rename via the asset store", () => {
      const group = makeGroup({ name: "Old name", isUntitled: true });
      useAssetStore.setState({ assets: [group] });
      render(<AssetCard asset={group} />);
      // Double-click the name → input appears.
      fireEvent.doubleClick(screen.getByText("Old name"));
      const input = screen.getByLabelText(
        /Rename group Old name/i,
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "New name" } });
      fireEvent.keyDown(input, { key: "Enter" });
      // Asset store updated; isUntitled flipped to false.
      const after = useAssetStore.getState().getAsset(group.id);
      if (after?.kind === "asset-group") {
        expect(after.name).toBe("New name");
        expect(after.isUntitled).toBe(false);
      } else {
        throw new Error("expected an asset-group after rename");
      }
    });

    it("delete button calls removeGroup (NOT removeAsset)", () => {
      const group = makeGroup({ assetIds: ["a-1"] });
      const linkedImage = seedImageAsset(
        "a-1",
        "https://x/1.png",
      );
      useAssetStore.setState({ assets: [linkedImage, group] });

      render(<AssetCard asset={group} />);
      fireEvent.click(
        screen.getByLabelText(`Delete group ${group.name}`),
      );
      // Group dropped; underlying image survives.
      expect(useAssetStore.getState().getAsset(group.id)).toBeUndefined();
      expect(useAssetStore.getState().getAsset("a-1")?.kind).toBe("image");
    });

    it("dragging a group writes the multi-id payload with kind 'asset-group'", () => {
      const group = makeGroup({ assetIds: ["a-1", "a-2"] });
      useAssetStore.setState({
        assets: [
          seedImageAsset("a-1", "https://x/1.png"),
          seedImageAsset("a-2", "https://x/2.png"),
          group,
        ],
      });
      render(<AssetCard asset={group} />);
      const setData = vi.fn();
      fireEvent.dragStart(screen.getByTestId("asset-card"), {
        dataTransfer: { setData, effectAllowed: "" },
      });
      const [, payload] = setData.mock.calls[0]!;
      expect(parseAssetDrag(payload as string)).toEqual({
        assetIds: [group.id],
        kind: "asset-group",
      });
    });

    it("calls onOpen with the group on double-click anywhere on the card (canvas / subview entry)", () => {
      const group = makeGroup();
      useAssetStore.setState({ assets: [group] });
      const onOpen = vi.fn();
      render(<AssetCard asset={group} onOpen={onOpen} />);
      // Use the mosaic (not the name) so we hit the card's
      // double-click handler, not the inline-rename one.
      fireEvent.doubleClick(screen.getByTestId("asset-group-mosaic"));
      expect(onOpen).toHaveBeenCalledWith(group);
    });
  });
});
