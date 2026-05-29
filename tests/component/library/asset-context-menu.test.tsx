import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AssetContextMenu } from "@/components/library/asset-context-menu";
import { useAssetStore } from "@/lib/stores/asset-store";
import type {
  AssetGroupAsset,
  ImageAsset,
  SoulIdAsset,
} from "@/types/asset";

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

const imageAsset: ImageAsset = {
  id: "img_1",
  kind: "image",
  name: "Cat",
  tags: [],
  scope: "project",
  createdAt: 1,
  updatedAt: 1,
  source: { type: "url", url: "https://example.com/cat.jpg" },
};

const imageAsset2: ImageAsset = {
  ...imageAsset,
  id: "img_2",
  name: "Dog",
};

const soulIdAsset: SoulIdAsset = {
  id: "sid_1",
  kind: "soul-id",
  name: "Me",
  tags: [],
  scope: "project",
  createdAt: 1,
  updatedAt: 1,
  customReferenceId: "8a3f4c89-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
  variant: "v2",
  thumbnailUrl: null,
};

const groupAsset: AssetGroupAsset = {
  id: "grp_1",
  kind: "asset-group",
  name: "Holiday photos",
  tags: [],
  scope: "project",
  createdAt: 1,
  updatedAt: 1,
  assetIds: ["img_1", "img_2"],
  isUntitled: false,
};

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
});

function renderMenu(asset: typeof imageAsset | SoulIdAsset | AssetGroupAsset, onRequestRename = vi.fn()) {
  // The right-click target — fireEvent.contextMenu on the trigger opens
  // the menu's portal, after which we can read items via screen.
  return render(
    <AssetContextMenu asset={asset} onRequestRename={onRequestRename}>
      <div data-testid="trigger">card</div>
    </AssetContextMenu>,
  );
}

async function openMenu() {
  fireEvent.contextMenu(screen.getByTestId("trigger"));
  // Items appear once the popover commits.
  await waitFor(() => {
    expect(screen.getByTestId("asset-context-menu-delete")).toBeTruthy();
  });
}

describe("<AssetContextMenu />", () => {
  describe("image asset (single)", () => {
    beforeEach(() => {
      useAssetStore.setState({ assets: [imageAsset] });
    });

    it("shows Rename + Delete, but NO Train Soul ID (that moved to groups in M0b)", async () => {
      renderMenu(imageAsset);
      await openMenu();
      expect(screen.getByTestId("asset-context-menu-rename")).toBeTruthy();
      expect(
        screen.queryByTestId("asset-context-menu-train-soul-id"),
      ).toBeNull();
      expect(screen.getByTestId("asset-context-menu-delete")).toBeTruthy();
    });

    it("Rename item calls onRequestRename callback", async () => {
      const onRequestRename = vi.fn();
      renderMenu(imageAsset, onRequestRename);
      await openMenu();
      fireEvent.click(screen.getByTestId("asset-context-menu-rename"));
      expect(onRequestRename).toHaveBeenCalledTimes(1);
    });

    it("Delete item calls removeAsset on the targeted id", async () => {
      renderMenu(imageAsset);
      await openMenu();
      fireEvent.click(screen.getByTestId("asset-context-menu-delete"));
      await waitFor(() => {
        expect(useAssetStore.getState().getAsset("img_1")).toBeUndefined();
      });
    });
  });

  describe("group asset (single)", () => {
    beforeEach(() => {
      useAssetStore.setState({
        assets: [imageAsset, imageAsset2, groupAsset],
      });
    });

    it("shows Rename + Duplicate group + Train as Soul ID + Delete", async () => {
      renderMenu(groupAsset);
      await openMenu();
      expect(screen.getByTestId("asset-context-menu-rename")).toBeTruthy();
      expect(
        screen.getByTestId("asset-context-menu-duplicate-group"),
      ).toBeTruthy();
      expect(
        screen.getByTestId("asset-context-menu-train-soul-id"),
      ).toBeTruthy();
      expect(screen.getByTestId("asset-context-menu-delete")).toBeTruthy();
    });

    it("Duplicate group creates a new group with the same assetIds and a (copy) suffix", async () => {
      renderMenu(groupAsset);
      await openMenu();
      fireEvent.click(
        screen.getByTestId("asset-context-menu-duplicate-group"),
      );
      const groups = useAssetStore
        .getState()
        .assets.filter((a): a is AssetGroupAsset => a.kind === "asset-group");
      expect(groups).toHaveLength(2);
      const dup = groups.find((g) => g.id !== groupAsset.id);
      expect(dup?.name).toBe("Holiday photos (copy)");
      expect(dup?.assetIds).toEqual(["img_1", "img_2"]);
      expect(dup?.isUntitled).toBe(false);
    });

    it("Delete on a group calls removeGroup (members survive)", async () => {
      renderMenu(groupAsset);
      await openMenu();
      fireEvent.click(screen.getByTestId("asset-context-menu-delete"));
      await waitFor(() => {
        expect(useAssetStore.getState().getAsset(groupAsset.id)).toBeUndefined();
      });
      // Members still alive.
      expect(useAssetStore.getState().getAsset("img_1")).toBeTruthy();
      expect(useAssetStore.getState().getAsset("img_2")).toBeTruthy();
    });
  });

  describe("multi-selection (image cards)", () => {
    beforeEach(() => {
      useAssetStore.setState({
        assets: [imageAsset, imageAsset2],
        selectedAssetIds: [imageAsset.id, imageAsset2.id],
      });
    });

    it("shows 'Delete N items' when 2+ selected and target is in selection", async () => {
      renderMenu(imageAsset);
      await openMenu();
      const del = screen.getByTestId("asset-context-menu-delete");
      expect(del.textContent).toMatch(/Delete 2 items/);
    });

    it("hides Rename in multi-selection mode (no plural rename)", async () => {
      renderMenu(imageAsset);
      await openMenu();
      expect(
        screen.queryByTestId("asset-context-menu-rename"),
      ).toBeNull();
    });

    it("Delete N items calls removeAssets with all selected ids", async () => {
      renderMenu(imageAsset);
      await openMenu();
      fireEvent.click(screen.getByTestId("asset-context-menu-delete"));
      await waitFor(() => {
        expect(useAssetStore.getState().assets).toHaveLength(0);
      });
    });
  });

  describe("soul-id asset", () => {
    beforeEach(() => {
      useAssetStore.setState({ assets: [soulIdAsset] });
    });

    it("shows Rename + Delete; no Add to group (soul-id has no group membership)", async () => {
      renderMenu(soulIdAsset);
      await openMenu();
      expect(screen.getByTestId("asset-context-menu-rename")).toBeTruthy();
      expect(screen.getByTestId("asset-context-menu-delete")).toBeTruthy();
      // No Add-to-group submenu trigger — that's a sub menu so the
      // testid only attaches to its leaf items.
      expect(
        screen.queryByTestId("asset-context-menu-new-group"),
      ).toBeNull();
    });
  });
});
