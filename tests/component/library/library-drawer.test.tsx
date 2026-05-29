import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { LibraryDrawer } from "@/components/layout/library-drawer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import type { ImageAsset, VideoAsset } from "@/types/asset";

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  uploadMediaAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function img(id: string, name: string): ImageAsset {
  return {
    id,
    kind: "image",
    name,
    tags: [],
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    source: { type: "url", url: `https://x/${id}.png` },
  };
}

function vid(id: string, name: string): VideoAsset {
  return {
    id,
    kind: "video",
    name,
    tags: [],
    scope: "project",
    createdAt: 0,
    updatedAt: 0,
    source: { type: "url", url: `https://x/${id}.mp4` },
  };
}

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
  useLayoutStore.setState({
    libraryDrawerOpen: true,
    libraryView: "grid",
    libraryThumb: "m",
  });
});

afterEach(() => {
  cleanup();
});

function renderDrawer() {
  return render(
    <TooltipProvider>
      <LibraryDrawer />
    </TooltipProvider>,
  );
}

describe("<LibraryDrawer />", () => {
  it("renders nothing when closed", () => {
    useLayoutStore.setState({ libraryDrawerOpen: false });
    renderDrawer();
    expect(screen.queryByTestId("library-drawer")).toBeNull();
  });

  it("renders sections for the present asset kinds when open", () => {
    useAssetStore.setState({ assets: [img("a1", "Cat"), vid("v1", "Clip")] });
    renderDrawer();
    expect(screen.getByTestId("library-drawer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Images" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Videos" })).toBeInTheDocument();
  });

  it("filters to a single kind when a chip is chosen", () => {
    useAssetStore.setState({ assets: [img("a1", "Cat"), vid("v1", "Clip")] });
    renderDrawer();
    fireEvent.click(screen.getByTestId("library-chip-video"));
    expect(screen.queryByRole("heading", { name: "Images" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Videos" })).toBeInTheDocument();
  });

  it("shows the bulk bar when assets are selected and bulk-deletes", async () => {
    window.confirm = vi.fn(() => true);
    useAssetStore.setState({
      assets: [img("a1", "Cat"), img("a2", "Dog")],
      selectedAssetIds: ["a1", "a2"],
    });
    renderDrawer();
    const bulkBar = screen.getByTestId("library-bulk-bar");
    expect(within(bulkBar).getByText("2 selected")).toBeInTheDocument();

    fireEvent.click(within(bulkBar).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(useAssetStore.getState().getAsset("a1")).toBeUndefined();
      expect(useAssetStore.getState().getAsset("a2")).toBeUndefined();
    });
  });

  it("groups selected images via the bulk bar", () => {
    useAssetStore.setState({
      assets: [img("a1", "Cat"), img("a2", "Dog")],
      selectedAssetIds: ["a1", "a2"],
    });
    renderDrawer();
    const bulkBar = screen.getByTestId("library-bulk-bar");
    fireEvent.click(within(bulkBar).getByRole("button", { name: "Group" }));
    const groups = useAssetStore
      .getState()
      .assets.filter((a) => a.kind === "asset-group");
    expect(groups).toHaveLength(1);
    if (groups[0]?.kind === "asset-group") {
      expect(groups[0].assetIds).toEqual(["a1", "a2"]);
    }
  });
});
