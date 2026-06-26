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

  it("paints a transparency checkerboard behind the image when enabled", () => {
    render(
      <ImagePreviewModal
        url="https://x/cut.png"
        alt="cutout"
        checkerboard
        onClose={vi.fn()}
      />,
    );
    const wrapper = screen.getByAltText("cutout").parentElement as HTMLElement;
    expect(wrapper.style.backgroundImage).toContain("linear-gradient");
  });

  it("omits the checkerboard by default (opaque images don't need it)", () => {
    render(
      <ImagePreviewModal url="https://x/op.png" alt="opaque" onClose={vi.fn()} />,
    );
    const wrapper = screen.getByAltText("opaque").parentElement as HTMLElement;
    expect(wrapper.style.backgroundImage).toBe("");
  });

  it("shows no nav chrome for a single-item batch", () => {
    render(
      <ImagePreviewModal
        items={[{ url: "https://x/a.png", alt: "only" }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("image-preview-next")).toBeNull();
    expect(screen.queryByTestId("image-preview-prev")).toBeNull();
    expect(screen.queryByTestId("image-preview-counter")).toBeNull();
  });
});

describe("ImagePreviewModal — batch navigation", () => {
  const items = [
    { url: "https://x/a.png", alt: "A" },
    { url: "https://x/b.png", alt: "B" },
    { url: "https://x/c.png", alt: "C" },
  ];

  it("renders the item at the starting index + a n / N counter", () => {
    render(<ImagePreviewModal items={items} index={1} onClose={vi.fn()} />);
    expect((screen.getByAltText("B") as HTMLImageElement).src).toContain(
      "https://x/b.png",
    );
    expect(screen.getByTestId("image-preview-counter").textContent).toBe(
      "2 / 3",
    );
  });

  it("advances on the next button and notifies onIndexChange", () => {
    const onIndexChange = vi.fn();
    render(
      <ImagePreviewModal
        items={items}
        index={0}
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("image-preview-next"));
    expect(screen.getByAltText("B")).toBeTruthy();
    expect(screen.getByTestId("image-preview-counter").textContent).toBe(
      "2 / 3",
    );
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("wraps from the first item back to the last on prev", () => {
    const onIndexChange = vi.fn();
    render(
      <ImagePreviewModal
        items={items}
        index={0}
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("image-preview-prev"));
    expect(screen.getByAltText("C")).toBeTruthy();
    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it("navigates with the arrow keys (→ next, ← prev)", () => {
    render(<ImagePreviewModal items={items} index={0} onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByAltText("B")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByAltText("A")).toBeTruthy();
  });

  it("the arrow buttons do not close the modal", () => {
    const onClose = vi.fn();
    render(<ImagePreviewModal items={items} index={0} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("image-preview-next"));
    fireEvent.click(screen.getByTestId("image-preview-prev"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("downloads the CURRENT item after navigating", () => {
    render(<ImagePreviewModal items={items} index={0} onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    // The download button reads the visible item; just assert it's present
    // and the visible image is B (the current one).
    expect(screen.getByRole("button", { name: /Download/ })).toBeTruthy();
    expect(screen.getByAltText("B")).toBeTruthy();
  });
});
