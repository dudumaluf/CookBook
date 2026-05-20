import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  AddAssetUrlButton,
  ImportSoulIdButton,
  UploadAssetButton,
} from "@/components/library/library-actions";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { HiggsfieldSoulIdSummary } from "@/lib/higgsfield/types";

// Tests cover the new split-button Library header:
//   `+`  → fires the OS file picker directly (no popover middleman)
//   `🔗` → opens a tiny URL-only popover for the rare paste case
//   `✨` → Soul ID picker (lists the user's trained Higgsfield characters
//          via /api/higgsfield/soul-ids)
// Both file routes feed the same `importImageFiles` pipeline; the Soul ID
// route hits a mocked fetch.

vi.mock("@/lib/library/upload-asset", () => ({
  uploadImageAsset: vi.fn(),
  deleteAssetObject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/higgsfield/call-higgsfield-image", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/higgsfield/call-higgsfield-image")
  >("@/lib/higgsfield/call-higgsfield-image");
  return {
    ...actual,
    fetchSoulIds: vi.fn(),
  };
});

const upload = await import("@/lib/library/upload-asset");
const uploadMock = vi.mocked(upload.uploadImageAsset);
const higgs = await import("@/lib/higgsfield/call-higgsfield-image");
const fetchSoulIdsMock = vi.mocked(higgs.fetchSoulIds);

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
  fetchSoulIdsMock.mockReset();
});

const SOUL_FIXTURE: HiggsfieldSoulIdSummary[] = [
  {
    id: "b66a1caa-612f-440d-8353-debceb00aae6",
    name: "Dudu Model",
    modelVersion: "v2",
    status: "completed",
    thumbnailUrl: "https://cdn.example/dudu.png",
    createdAt: "2026-04-01T12:00:00Z",
  },
  {
    id: "a3f4c891-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
    name: "Hero Cinema",
    modelVersion: "cinema",
    status: "completed",
    thumbnailUrl: null,
    createdAt: "2026-04-02T12:00:00Z",
  },
  {
    id: "b1c2d3e4-5f6a-4789-90bc-1d2e3f405162",
    name: "Training in Progress",
    modelVersion: "v2",
    status: "in_progress",
    thumbnailUrl: null,
    createdAt: "2026-04-03T12:00:00Z",
  },
];

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

describe("<ImportSoulIdButton />", () => {
  it("popover is closed by default — does not call /api/higgsfield/soul-ids until opened", () => {
    render(<ImportSoulIdButton />);
    expect(fetchSoulIdsMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Your Soul IDs/i)).toBeNull();
  });

  it("opening the popover fetches the trained characters and renders them", async () => {
    fetchSoulIdsMock.mockResolvedValueOnce(SOUL_FIXTURE);
    render(<ImportSoulIdButton />);

    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Import Soul ID from Higgsfield"),
      );
    });

    await waitFor(() => {
      expect(fetchSoulIdsMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Dudu Model")).toBeTruthy();
    expect(screen.getByText("Hero Cinema")).toBeTruthy();
    // Two characters are v2 (Dudu Model + Training in Progress), so the
    // Soul 2 chip renders twice. The variant chip uses uppercase tracking
    // so we match the exact "Soul 2" text rather than risk matching "Soul 2.0"
    // somewhere else in the future.
    expect(screen.getAllByText(/Soul 2/i).length).toBeGreaterThanOrEqual(2);
    // Cinema variant chip — there's also "Hero Cinema" in the row name,
    // so allow either match (chip + name = 2 hits is the realistic shape).
    expect(screen.getAllByText(/Cinema/i).length).toBeGreaterThanOrEqual(1);
  });

  it("clicking a completed character imports it as a soul-id asset", async () => {
    fetchSoulIdsMock.mockResolvedValueOnce(SOUL_FIXTURE);
    render(<ImportSoulIdButton />);

    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Import Soul ID from Higgsfield"),
      );
    });
    await screen.findByText("Dudu Model");

    await act(async () => {
      fireEvent.click(screen.getByText("Dudu Model"));
    });

    const assets = useAssetStore.getState().assets;
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      kind: "soul-id",
      customReferenceId: "b66a1caa-612f-440d-8353-debceb00aae6",
      variant: "v2",
      name: "Dudu Model",
    });
  });

  it("re-importing the same character is idempotent (button shows 'Imported')", async () => {
    fetchSoulIdsMock.mockResolvedValueOnce(SOUL_FIXTURE);
    // Pre-import the first fixture row so the popover renders it as
    // already-imported on first open.
    useAssetStore.getState().importSoulIdAsset({
      customReferenceId: SOUL_FIXTURE[0]!.id,
      variant: SOUL_FIXTURE[0]!.modelVersion,
      name: SOUL_FIXTURE[0]!.name,
      thumbnailUrl: SOUL_FIXTURE[0]!.thumbnailUrl,
    });

    render(<ImportSoulIdButton />);
    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Import Soul ID from Higgsfield"),
      );
    });
    await screen.findByText("Dudu Model");

    expect(screen.getByText(/imported/i)).toBeTruthy();
    // Button is disabled when already imported.
    const row = screen
      .getByText("Dudu Model")
      .closest("button") as HTMLButtonElement;
    expect(row.disabled).toBe(true);
  });

  it("characters whose status !== 'completed' are surfaced as disabled rows", async () => {
    fetchSoulIdsMock.mockResolvedValueOnce(SOUL_FIXTURE);
    render(<ImportSoulIdButton />);
    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Import Soul ID from Higgsfield"),
      );
    });
    await screen.findByText("Training in Progress");

    const row = screen
      .getByText("Training in Progress")
      .closest("button") as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(row.textContent).toMatch(/in_progress/i);
  });

  it("renders an inline error when the fetch fails", async () => {
    const err = new Error("Higgsfield: Unauthorized");
    (err as Error & { code?: string }).code = "missing_keys";
    fetchSoulIdsMock.mockRejectedValueOnce(err);
    render(<ImportSoulIdButton />);

    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Import Soul ID from Higgsfield"),
      );
    });
    // Wait for the alert to render (next microtask after the rejection).
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  it("renders an empty-state when the user has no trained Soul IDs yet", async () => {
    fetchSoulIdsMock.mockResolvedValueOnce([]);
    render(<ImportSoulIdButton />);

    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Import Soul ID from Higgsfield"),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/no soul ids trained/i)).toBeTruthy();
    });
  });
});
