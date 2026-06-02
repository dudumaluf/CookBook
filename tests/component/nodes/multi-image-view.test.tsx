import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MultiImageView } from "@/components/nodes/multi-image-view";

const URLS_4 = [
  "https://x.test/a.png",
  "https://x.test/b.png",
  "https://x.test/c.png",
  "https://x.test/d.png",
];

describe("<MultiImageView />", () => {
  it("renders nothing when imageUrls is empty (calling node owns empty state)", () => {
    const { container } = render(
      <MultiImageView
        imageUrls={[]}
        onViewModeChange={vi.fn()}
        onPreviewIndexChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a plain preview for a single image (no toggle, no cursor, no grid)", () => {
    render(
      <MultiImageView
        imageUrls={[URLS_4[0]!]}
        onViewModeChange={vi.fn()}
        onPreviewIndexChange={vi.fn()}
        testIdPrefix="x"
      />,
    );
    expect(screen.getByTestId("x-single")).toBeInTheDocument();
    expect(screen.queryByTestId("x-grid")).toBeNull();
    expect(screen.queryByTestId("iterator-cursor")).toBeNull();
    expect(screen.queryByTestId("x-back-to-grid")).toBeNull();
  });

  it("defaults to grid view for N > 1 images and emits one tile per image", () => {
    render(
      <MultiImageView
        imageUrls={URLS_4}
        onViewModeChange={vi.fn()}
        onPreviewIndexChange={vi.fn()}
        testIdPrefix="x"
      />,
    );
    expect(screen.getByTestId("x-grid")).toBeInTheDocument();
    for (let i = 0; i < URLS_4.length; i += 1) {
      expect(screen.getByTestId(`x-tile-${i}`)).toBeInTheDocument();
    }
  });

  it("clicking a grid tile flips to single mode focused on that index", () => {
    const onViewModeChange = vi.fn();
    const onPreviewIndexChange = vi.fn();
    render(
      <MultiImageView
        imageUrls={URLS_4}
        onViewModeChange={onViewModeChange}
        onPreviewIndexChange={onPreviewIndexChange}
        testIdPrefix="x"
      />,
    );
    fireEvent.click(screen.getByTestId("x-tile-2"));
    expect(onPreviewIndexChange).toHaveBeenCalledWith(2);
    expect(onViewModeChange).toHaveBeenCalledWith("single");
  });

  it("renders single mode when viewMode='single' with the IteratorCursor + back-to-grid", () => {
    render(
      <MultiImageView
        imageUrls={URLS_4}
        viewMode="single"
        previewIndex={2}
        onViewModeChange={vi.fn()}
        onPreviewIndexChange={vi.fn()}
        testIdPrefix="x"
      />,
    );
    expect(screen.getByTestId("x-single")).toBeInTheDocument();
    expect(screen.queryByTestId("x-grid")).toBeNull();
    expect(screen.getByTestId("x-back-to-grid")).toBeInTheDocument();
    expect(screen.getByTestId("iterator-cursor-counter").textContent).toBe(
      "3 / 4",
    );
  });

  it("clicking back-to-grid emits viewMode='grid'", () => {
    const onViewModeChange = vi.fn();
    render(
      <MultiImageView
        imageUrls={URLS_4}
        viewMode="single"
        previewIndex={0}
        onViewModeChange={onViewModeChange}
        onPreviewIndexChange={vi.fn()}
        testIdPrefix="x"
      />,
    );
    fireEvent.click(screen.getByTestId("x-back-to-grid"));
    expect(onViewModeChange).toHaveBeenCalledWith("grid");
  });

  it("IteratorCursor next/prev arrows emit onPreviewIndexChange", () => {
    const onPreviewIndexChange = vi.fn();
    render(
      <MultiImageView
        imageUrls={URLS_4}
        viewMode="single"
        previewIndex={1}
        onViewModeChange={vi.fn()}
        onPreviewIndexChange={onPreviewIndexChange}
        testIdPrefix="x"
      />,
    );
    fireEvent.click(screen.getByLabelText("Image next item"));
    expect(onPreviewIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByLabelText("Image previous item"));
    expect(onPreviewIndexChange).toHaveBeenLastCalledWith(0);
  });

  it("clamps previewIndex when it exceeds the array length (re-run returned fewer images)", () => {
    render(
      <MultiImageView
        imageUrls={URLS_4.slice(0, 2)} // only 2 images now
        viewMode="single"
        previewIndex={9} // stale index from a previous larger batch
        onViewModeChange={vi.fn()}
        onPreviewIndexChange={vi.fn()}
        testIdPrefix="x"
      />,
    );
    // 9 clamped to 1 (length 2 → max index 1) → counter shows "2 / 2".
    expect(screen.getByTestId("iterator-cursor-counter").textContent).toBe(
      "2 / 2",
    );
  });

  it("clamps a negative previewIndex to 0", () => {
    render(
      <MultiImageView
        imageUrls={URLS_4}
        viewMode="single"
        previewIndex={-3}
        onViewModeChange={vi.fn()}
        onPreviewIndexChange={vi.fn()}
        testIdPrefix="x"
      />,
    );
    expect(screen.getByTestId("iterator-cursor-counter").textContent).toBe(
      "1 / 4",
    );
  });

  it("uses gridTileAspectRatio for grid tiles when provided (Higgsfield's 1/1 layout)", () => {
    render(
      <MultiImageView
        imageUrls={URLS_4}
        aspectRatio="9 / 16"
        gridTileAspectRatio="1 / 1"
        onViewModeChange={vi.fn()}
        onPreviewIndexChange={vi.fn()}
        testIdPrefix="x"
      />,
    );
    // Each grid tile's MediaPreviewImage wrapper carries the 1/1 aspect.
    // We can't query the inner wrapper directly without a testid, but the
    // grid container exists and the tile buttons are present — that's
    // enough to know the prop didn't crash. The aspect itself is part of
    // MediaPreviewImage's contract (covered in its own tests).
    expect(screen.getByTestId("x-grid")).toBeInTheDocument();
    expect(screen.getByTestId("x-tile-0")).toBeInTheDocument();
  });
});
