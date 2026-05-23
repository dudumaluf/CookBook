import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

import { LibraryContent } from "@/components/library/library-content";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { AssetGroupAsset, ImageAsset, SoulIdAsset } from "@/types/asset";

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeImageAsset(id: string, url: string, name = id): ImageAsset {
  return {
    id,
    kind: "image",
    name,
    tags: [],
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    source: { type: "url", url },
  };
}

function makeSoulIdAsset(id: string): SoulIdAsset {
  return {
    id,
    kind: "soul-id",
    name: `Soul ${id}`,
    tags: [],
    scope: "global",
    createdAt: 0,
    updatedAt: 0,
    customReferenceId: id,
    variant: "v2",
    thumbnailUrl: null,
  };
}

function makeGroupAsset(id: string, name: string, assetIds: string[]): AssetGroupAsset {
  return {
    id,
    kind: "asset-group",
    name,
    tags: [],
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    assetIds,
    isUntitled: false,
  };
}

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
});

function renderLibrary() {
  return render(
    <TooltipProvider>
      <LibraryContent />
    </TooltipProvider>,
  );
}

describe("<LibraryContent /> — Slice 5.6b Groups section + subview", () => {
  it("does NOT render the Groups section when there are no group assets", () => {
    useAssetStore.setState({ assets: [makeImageAsset("a-1", "https://x/1.png")] });
    renderLibrary();
    expect(screen.queryByTestId("library-section-groups")).toBeNull();
    // Empty state copy: "No assets yet" only renders when ALL three
    // sections are empty — image asset is present, so it shouldn't.
    expect(screen.queryByText(/no assets yet/i)).toBeNull();
  });

  it("renders Groups, Soul IDs and Images sections when each kind is present", () => {
    useAssetStore.setState({
      assets: [
        makeSoulIdAsset("s-1"),
        makeGroupAsset("g-1", "Photoshoot", ["a-1"]),
        makeImageAsset("a-1", "https://x/1.png"),
      ],
    });
    renderLibrary();
    expect(screen.getByText("Soul IDs")).toBeInTheDocument();
    expect(screen.getByText("Groups")).toBeInTheDocument();
    expect(screen.getByText("Images")).toBeInTheDocument();
  });

  it("double-clicking a group card flips the panel into the subview", () => {
    useAssetStore.setState({
      assets: [
        makeImageAsset("a-1", "https://x/1.png", "First"),
        makeImageAsset("a-2", "https://x/2.png", "Second"),
        makeGroupAsset("g-1", "Photoshoot Paris", ["a-1", "a-2"]),
      ],
    });
    renderLibrary();

    // Top-level: subview not rendered yet.
    expect(screen.queryByTestId("library-group-subview")).toBeNull();

    // Double-click the group card's mosaic (the name handler is
    // inline-rename, not subview-open).
    fireEvent.doubleClick(screen.getByTestId("asset-group-mosaic"));
    expect(screen.getByTestId("library-group-subview")).toBeInTheDocument();
    // Subview header carries the group name.
    expect(screen.getByText("Photoshoot Paris")).toBeInTheDocument();
    // Both members are rendered as image AssetCards inside the subview.
    expect(screen.getByAltText("First")).toBeInTheDocument();
    expect(screen.getByAltText("Second")).toBeInTheDocument();
  });

  it("clicking the back arrow restores the top-level view", () => {
    useAssetStore.setState({
      assets: [
        makeImageAsset("a-1", "https://x/1.png"),
        makeGroupAsset("g-1", "Group A", ["a-1"]),
      ],
    });
    renderLibrary();
    fireEvent.doubleClick(screen.getByTestId("asset-group-mosaic"));
    expect(screen.getByTestId("library-group-subview")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("library-group-subview-back"));
    expect(screen.queryByTestId("library-group-subview")).toBeNull();
    // Top-level Groups section back.
    expect(screen.getByTestId("library-section-groups")).toBeInTheDocument();
  });

  it("subview shows an empty-state copy when the group has no resolvable images", () => {
    useAssetStore.setState({
      // Group references an asset that doesn't exist.
      assets: [makeGroupAsset("g-1", "Empty group", ["a-missing"])],
    });
    renderLibrary();
    fireEvent.doubleClick(screen.getByTestId("asset-group-mosaic"));
    expect(screen.getByText(/this group is empty/i)).toBeInTheDocument();
  });
});
