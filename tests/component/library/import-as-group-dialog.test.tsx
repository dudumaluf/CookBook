import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ImportAsGroupDialog } from "@/components/library/import-as-group-dialog";
import { useAssetStore } from "@/lib/stores/asset-store";

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(async (file: File) => ({
    bucket: "cookbook-assets",
    key: `images/x/${file.name}`,
    url: `https://cdn.supabase.test/cookbook-assets/images/x/${file.name}`,
    mime: file.type || "application/octet-stream",
    sizeBytes: file.size,
  })),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
});

function makeImageFile(name: string) {
  return new File([new Uint8Array(10)], name, { type: "image/png" });
}

describe("<ImportAsGroupDialog /> — Slice 5.6c", () => {
  it("does NOT render anything when files === null (closed state)", () => {
    render(<ImportAsGroupDialog files={null} onClose={() => undefined} />);
    expect(screen.queryByText(/Import.*images/i)).toBeNull();
  });

  it("renders the dialog with the file count + two action buttons + cancel", () => {
    const files = [makeImageFile("a.png"), makeImageFile("b.png")];
    render(<ImportAsGroupDialog files={files} onClose={() => undefined} />);
    expect(screen.getByText(/Import 2 images/i)).toBeInTheDocument();
    expect(
      screen.getByTestId("import-as-separate-button"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("import-as-group-button"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("import-as-group-cancel"),
    ).toBeInTheDocument();
  });

  it("'Import as N separate' creates N image assets WITHOUT creating a group, and closes", async () => {
    const onClose = vi.fn();
    const files = [makeImageFile("a.png"), makeImageFile("b.png")];
    render(<ImportAsGroupDialog files={files} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("import-as-separate-button"));

    await waitFor(() => {
      expect(useAssetStore.getState().assets).toHaveLength(2);
    });
    const groups = useAssetStore
      .getState()
      .assets.filter((a) => a.kind === "asset-group");
    expect(groups).toHaveLength(0);
    expect(onClose).toHaveBeenCalled();
  });

  it("'Import as group' creates the images + a named group, and closes", async () => {
    const onClose = vi.fn();
    const files = [makeImageFile("a.png"), makeImageFile("b.png")];
    render(<ImportAsGroupDialog files={files} onClose={onClose} />);
    // Update the name input.
    const nameInput = screen.getByLabelText(/Group name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Photoshoot Paris" } });
    fireEvent.click(screen.getByTestId("import-as-group-button"));

    await waitFor(() => {
      const groups = useAssetStore
        .getState()
        .assets.filter((a) => a.kind === "asset-group");
      expect(groups).toHaveLength(1);
    });
    const group = useAssetStore
      .getState()
      .assets.find((a) => a.kind === "asset-group");
    if (group?.kind === "asset-group") {
      expect(group.name).toBe("Photoshoot Paris");
      expect(group.assetIds).toHaveLength(2);
      expect(group.isUntitled).toBe(false);
    } else {
      throw new Error("expected an asset-group");
    }
    expect(onClose).toHaveBeenCalled();
  });

  it("'Import as group' with empty name falls back to 'Untitled'", async () => {
    const onClose = vi.fn();
    const files = [makeImageFile("a.png")];
    render(<ImportAsGroupDialog files={files} onClose={onClose} />);
    const nameInput = screen.getByLabelText(/Group name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("import-as-group-button"));

    await waitFor(() => {
      const group = useAssetStore
        .getState()
        .assets.find((a) => a.kind === "asset-group");
      expect(group?.name).toBe("Untitled");
    });
  });

  it("Cancel button calls onClose without importing anything", () => {
    const onClose = vi.fn();
    const files = [makeImageFile("a.png"), makeImageFile("b.png")];
    render(<ImportAsGroupDialog files={files} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("import-as-group-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(useAssetStore.getState().assets).toHaveLength(0);
  });

  it("pressing Enter inside the name input triggers 'Import as group'", async () => {
    const onClose = vi.fn();
    const files = [makeImageFile("a.png"), makeImageFile("b.png")];
    render(<ImportAsGroupDialog files={files} onClose={onClose} />);
    const nameInput = screen.getByLabelText(/Group name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Quick" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() => {
      const group = useAssetStore
        .getState()
        .assets.find((a) => a.kind === "asset-group");
      expect(group?.name).toBe("Quick");
    });
    expect(onClose).toHaveBeenCalled();
  });
});
