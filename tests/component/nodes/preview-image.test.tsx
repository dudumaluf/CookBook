import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/library/download", () => ({
  downloadFromUrl: vi.fn().mockResolvedValue(undefined),
  safeFilename: (s: string) => s,
}));

import { PreviewImage } from "@/components/nodes/preview-image";

describe("<PreviewImage />", () => {
  it("renders a clickable preview with no modal open initially", () => {
    render(<PreviewImage url="https://x/a.png" alt="Cutout" testId="px" />);
    expect(screen.getByTestId("px")).toBeTruthy();
    expect(screen.queryByTestId("image-preview-modal")).toBeNull();
  });

  it("opens the full-screen preview modal (with Download) on click", () => {
    render(<PreviewImage url="https://x/a.png" alt="Cutout" testId="px" />);
    fireEvent.click(screen.getByTestId("px"));
    expect(screen.getByTestId("image-preview-modal")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download/ })).toBeTruthy();
  });

  it("exposes a right-click download menu without opening the modal", async () => {
    render(<PreviewImage url="https://x/a.png" alt="Cutout" testId="px" />);
    fireEvent.contextMenu(screen.getByTestId("px"));
    await waitFor(() => {
      expect(screen.getByTestId("image-context-menu-download")).toBeTruthy();
    });
    expect(screen.queryByTestId("image-preview-modal")).toBeNull();
  });
});
