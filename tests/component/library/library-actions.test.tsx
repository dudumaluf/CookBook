import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  AddAssetUrlButton,
  UploadAssetButton,
} from "@/components/library/library-actions";
import { useAssetStore } from "@/lib/stores/asset-store";

// Tests cover the new split-button Library header:
//   `+`  → fires the OS file picker directly (no popover middleman)
//   `🔗` → opens a tiny URL-only popover for the rare paste case
// Both routes feed the same `importImageFiles` pipeline, so we mock the
// uploader to keep these unit-scoped.

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

const upload = await import("@/lib/library/upload-asset");
const uploadMock = vi.mocked(upload.uploadImageAsset);

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
  uploadMock.mockReset();
  uploadMock.mockImplementation(async (file: File) => ({
    bucket: "cookbook-assets",
    key: `images/x/${file.name}`,
    url: `https://cdn.supabase.test/cookbook-assets/images/x/${file.name}`,
    mime: file.type || "application/octet-stream",
    sizeBytes: file.size,
  }));
});

describe("<UploadAssetButton />", () => {
  it("renders a Plus button + a hidden file input — no popover", () => {
    render(<UploadAssetButton />);
    expect(screen.getByLabelText("Upload image from disk")).toBeTruthy();
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.multiple).toBe(true);
    expect(fileInput.accept).toBe("image/*");
    // No popover — there should be no "Or add an image URL"-style disclosure.
    expect(screen.queryByText(/Or add an image URL/)).toBeNull();
  });

  it("file picker selection uploads through the import pipeline", async () => {
    render(<UploadAssetButton />);
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["bytes"], "Cat.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(useAssetStore.getState().assets).toHaveLength(1);
    });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const asset = useAssetStore.getState().assets[0]!;
    if (asset.kind === "image") {
      expect(asset.source.type).toBe("remote");
    }
  });

  it("swaps the icon to a spinner while the upload is in flight", async () => {
    let resolve: ((v: never) => void) | null = null;
    uploadMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r as never;
        }),
    );
    render(<UploadAssetButton />);
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["x"], "Slow.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    // Button stays mounted under the same aria-label but is now disabled
    // and renders the spinner instead of the plus.
    const button = screen.getByLabelText(
      "Upload image from disk",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("Uploading…")).toBeTruthy();

    await act(async () => {
      resolve!({
        bucket: "cookbook-assets",
        key: "images/x/Slow.png",
        url: "https://cdn.supabase.test/x",
        mime: "image/png",
        sizeBytes: 1,
      } as never);
    });
  });
});

describe("<AddAssetUrlButton />", () => {
  it("popover is closed by default and reveals a URL form on click", () => {
    render(<AddAssetUrlButton />);
    expect(screen.queryByPlaceholderText("https://…")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByLabelText("Add image by URL"));
    });

    expect(screen.getByPlaceholderText("https://…")).toBeTruthy();
  });

  it("submitting a URL creates a url-source asset (no upload roundtrip)", () => {
    render(<AddAssetUrlButton />);
    act(() => {
      fireEvent.click(screen.getByLabelText("Add image by URL"));
    });

    const input = screen.getByPlaceholderText("https://…") as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "https://example.com/cat.jpg" },
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Add URL" }));
    });

    expect(uploadMock).not.toHaveBeenCalled();
    const assets = useAssetStore.getState().assets;
    expect(assets).toHaveLength(1);
    if (assets[0]?.kind === "image") {
      expect(assets[0].source).toEqual({
        type: "url",
        url: "https://example.com/cat.jpg",
      });
    }
  });
});
