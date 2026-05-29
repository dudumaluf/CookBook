import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LibraryToolbar } from "@/components/library/library-toolbar";
import { TooltipProvider } from "@/components/ui/tooltip";

function setup(overrides: Partial<Parameters<typeof LibraryToolbar>[0]> = {}) {
  const props = {
    query: "",
    onQueryChange: vi.fn(),
    chips: [
      { id: "all", label: "All", count: 3 },
      { id: "image", label: "Images", count: 2 },
      { id: "video", label: "Videos", count: 1 },
    ],
    activeChip: "all",
    onChipChange: vi.fn(),
    view: "grid" as const,
    onViewChange: vi.fn(),
    thumb: "m" as const,
    onThumbChange: vi.fn(),
    onExpand: vi.fn(),
    ...overrides,
  };
  render(
    <TooltipProvider>
      <LibraryToolbar {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe("<LibraryToolbar />", () => {
  it("emits query changes from the search input", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText("Search assets"), {
      target: { value: "cat" },
    });
    expect(props.onQueryChange).toHaveBeenCalledWith("cat");
  });

  it("renders chips with counts and emits the chosen filter", () => {
    const props = setup();
    expect(screen.getByTestId("library-chip-image").textContent).toContain("2");
    fireEvent.click(screen.getByTestId("library-chip-video"));
    expect(props.onChipChange).toHaveBeenCalledWith("video");
  });

  it("toggles view between grid and list", () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText("List view"));
    expect(props.onViewChange).toHaveBeenCalledWith("list");
  });

  it("shows the thumbnail-size control only in grid view and emits it", () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText("Thumbnail size L"));
    expect(props.onThumbChange).toHaveBeenCalledWith("l");
  });

  it("hides the thumbnail-size control in list view", () => {
    setup({ view: "list" });
    expect(screen.queryByLabelText("Thumbnail size L")).toBeNull();
  });

  it("fires onExpand when the expand button is clicked", () => {
    const props = setup();
    fireEvent.click(screen.getByLabelText("Expand library"));
    expect(props.onExpand).toHaveBeenCalled();
  });
});
