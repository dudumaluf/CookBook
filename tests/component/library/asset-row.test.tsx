import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AssetRow } from "@/components/library/asset-row";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { ImageAsset } from "@/types/asset";

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

const asset: ImageAsset = {
  id: "asset_row",
  kind: "image",
  name: "Row Cat",
  tags: [],
  scope: "project",
  createdAt: 0,
  updatedAt: 0,
  source: { type: "url", url: "https://x/cat.png" },
};

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
});

function renderRow() {
  return render(
    <TooltipProvider>
      <AssetRow asset={asset} />
    </TooltipProvider>,
  );
}

describe("<AssetRow />", () => {
  it("renders the name + kind label in a row", () => {
    useAssetStore.setState({ assets: [asset] });
    renderRow();
    expect(screen.getByText("Row Cat")).toBeInTheDocument();
    expect(screen.getByText("Image")).toBeInTheDocument();
    expect(screen.getByTestId("asset-row")).toBeInTheDocument();
  });

  it("plain click selects the asset in the store", () => {
    useAssetStore.setState({ assets: [asset] });
    renderRow();
    fireEvent.click(screen.getByTestId("asset-row"));
    expect(useAssetStore.getState().selectedAssetIds).toEqual([asset.id]);
  });

  it("delete button removes the asset", async () => {
    useAssetStore.setState({ assets: [asset] });
    renderRow();
    fireEvent.click(screen.getByLabelText("Delete asset Row Cat"));
    await waitFor(() => {
      expect(useAssetStore.getState().getAsset(asset.id)).toBeUndefined();
    });
  });

  it("drag start writes the custom asset MIME payload", () => {
    useAssetStore.setState({ assets: [asset] });
    renderRow();
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTestId("asset-row"), {
      dataTransfer: { setData, effectAllowed: "" },
    });
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData.mock.calls[0]![0]).toBe("application/x-cookbook-asset");
  });
});
