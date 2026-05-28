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

// Slice 6.6 — LibraryContent now uses useRecipes() which transitively
// touches Supabase. These tests don't care about recipes; stub the
// hook so it just yields an empty list with no network calls.
vi.mock("@/lib/hooks/use-recipes", () => ({
  useRecipes: () => ({
    data: [],
    isLoading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
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

  it("renders Groups, Soul IDs and Images sections when each kind has bare members", () => {
    // Slice 5.6.1: an image inside a group does NOT count toward
    // Images. We seed an extra bare image so Images still appears.
    useAssetStore.setState({
      assets: [
        makeSoulIdAsset("s-1"),
        makeGroupAsset("g-1", "Photoshoot", ["a-grouped"]),
        makeImageAsset("a-grouped", "https://x/1.png"),
        makeImageAsset("a-bare", "https://x/2.png", "Bare"),
      ],
    });
    renderLibrary();
    expect(screen.getByText("Soul IDs")).toBeInTheDocument();
    expect(screen.getByText("Groups")).toBeInTheDocument();
    expect(screen.getByText("Images")).toBeInTheDocument();
  });

  /* ───────── Slice 5.6.1: hide grouped images from "Images" ───────── */

  it("an image that's a member of a group is absent from the top-level Images section", () => {
    useAssetStore.setState({
      assets: [
        makeImageAsset("a-grouped", "https://x/1.png", "Inside"),
        makeImageAsset("a-bare", "https://x/2.png", "Outside"),
        makeGroupAsset("g-1", "Group A", ["a-grouped"]),
      ],
    });
    renderLibrary();
    // Bare image renders in the top-level Images section.
    expect(screen.getByAltText("Outside")).toBeInTheDocument();
    // Grouped image does NOT render at the top level (it's only
    // visible inside the group subview).
    expect(screen.queryByAltText("Inside")).toBeNull();
  });

  it("when ALL images are grouped, the Images section disappears entirely", () => {
    useAssetStore.setState({
      assets: [
        makeImageAsset("a-1", "https://x/1.png"),
        makeImageAsset("a-2", "https://x/2.png"),
        makeGroupAsset("g-1", "All grouped", ["a-1", "a-2"]),
      ],
    });
    renderLibrary();
    expect(screen.queryByText("Images")).toBeNull();
    // Group section still there.
    expect(screen.getByTestId("library-section-groups")).toBeInTheDocument();
  });

  it("the bare image becomes visible in the group's subview after entering it", () => {
    // Sanity: the grouped image is not lost — it's just relocated.
    useAssetStore.setState({
      assets: [
        makeImageAsset("a-1", "https://x/1.png", "Inside"),
        makeGroupAsset("g-1", "Group A", ["a-1"]),
      ],
    });
    renderLibrary();
    // Top-level: image hidden.
    expect(screen.queryByAltText("Inside")).toBeNull();
    // Enter the group → image now renders.
    fireEvent.doubleClick(screen.getByTestId("asset-group-mosaic"));
    expect(screen.getByAltText("Inside")).toBeInTheDocument();
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

/* ────────────────────────────────────────────────────────────────────── */
/* Slice 5.6f: multi-delete via Backspace / Delete                         */
/* ────────────────────────────────────────────────────────────────────── */

describe("<LibraryContent /> — Slice 5.6f Backspace multi-delete", () => {
  it("Backspace with non-empty selection batch-deletes via removeAssets", async () => {
    useAssetStore.setState({
      assets: [
        makeImageAsset("a-1", "https://x/1.png"),
        makeImageAsset("a-2", "https://x/2.png"),
        makeImageAsset("a-3", "https://x/3.png"),
      ],
      selectedAssetIds: ["a-1", "a-2"],
    });
    const { container } = renderLibrary();
    // Fire keydown on the panel root (the listener is mounted there).
    const panel = container.firstElementChild as HTMLElement;
    fireEvent.keyDown(panel, { key: "Backspace" });
    // Wait a microtask for the async removeAssets to settle.
    await Promise.resolve();
    expect(useAssetStore.getState().getAsset("a-1")).toBeUndefined();
    expect(useAssetStore.getState().getAsset("a-2")).toBeUndefined();
    expect(useAssetStore.getState().getAsset("a-3")).toBeTruthy();
    expect(useAssetStore.getState().selectedAssetIds).toEqual([]);
  });

  it("Backspace with EMPTY selection is a no-op", () => {
    useAssetStore.setState({
      assets: [makeImageAsset("a-1", "https://x/1.png")],
      selectedAssetIds: [],
    });
    const { container } = renderLibrary();
    const panel = container.firstElementChild as HTMLElement;
    fireEvent.keyDown(panel, { key: "Backspace" });
    // Asset still alive — no delete fired.
    expect(useAssetStore.getState().getAsset("a-1")).toBeTruthy();
  });

  it("Delete key is also accepted (alias of Backspace)", async () => {
    useAssetStore.setState({
      assets: [makeImageAsset("a-1", "https://x/1.png")],
      selectedAssetIds: ["a-1"],
    });
    const { container } = renderLibrary();
    const panel = container.firstElementChild as HTMLElement;
    fireEvent.keyDown(panel, { key: "Delete" });
    await Promise.resolve();
    expect(useAssetStore.getState().getAsset("a-1")).toBeUndefined();
  });

  it("Backspace inside an INPUT element is ignored (so the inline-rename keystroke isn't intercepted)", () => {
    useAssetStore.setState({
      assets: [makeImageAsset("a-1", "https://x/1.png")],
      selectedAssetIds: ["a-1"],
    });
    const { container } = renderLibrary();
    // Simulate focus inside an input — for this we synthesize an
    // input element, focus it, then fire the keystroke on the panel.
    const fakeInput = document.createElement("input");
    document.body.appendChild(fakeInput);
    fakeInput.focus();
    expect(document.activeElement).toBe(fakeInput);
    const panel = container.firstElementChild as HTMLElement;
    fireEvent.keyDown(panel, { key: "Backspace" });
    // Asset still alive — listener bailed because focus was in an input.
    expect(useAssetStore.getState().getAsset("a-1")).toBeTruthy();
    document.body.removeChild(fakeInput);
  });
});
