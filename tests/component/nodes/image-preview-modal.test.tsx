import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ImagePreviewModal } from "@/components/nodes/image-preview-modal";

/**
 * The modal renders through a portal to document.body. testing-library's
 * `screen` queries the whole document, so portal content is reachable.
 */

describe("ImagePreviewModal", () => {
  it("renders the image with the provided alt", () => {
    render(
      <ImagePreviewModal url="https://x/g.png" alt="My grid" onClose={vi.fn()} />,
    );
    const img = screen.getByAltText("My grid") as HTMLImageElement;
    expect(img.src).toContain("https://x/g.png");
  });

  it("offers a download button", () => {
    render(
      <ImagePreviewModal url="https://x/g.png" alt="My grid" onClose={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Download/ })).toBeTruthy();
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <ImagePreviewModal url="https://x/g.png" alt="My grid" onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId("image-preview-modal"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close when the image itself is clicked", () => {
    const onClose = vi.fn();
    render(
      <ImagePreviewModal url="https://x/g.png" alt="My grid" onClose={onClose} />,
    );
    fireEvent.click(screen.getByAltText("My grid"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on the X button", () => {
    const onClose = vi.fn();
    render(
      <ImagePreviewModal url="https://x/g.png" alt="My grid" onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Close preview/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <ImagePreviewModal url="https://x/g.png" alt="My grid" onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
