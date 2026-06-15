import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { imageGridNodeSchema } from "@/components/nodes/node-image-grid";
import { useExecutionStore } from "@/lib/stores/execution-store";
import type { ExecutionRecord } from "@/types/node";

const Body = imageGridNodeSchema.Body;

function seedRecord(nodeId: string, record: ExecutionRecord) {
  useExecutionStore.setState({ records: new Map([[nodeId, record]]) });
}

function renderBody(nodeId = "grid_1") {
  render(
    <Body
      nodeId={nodeId}
      config={{ portCount: 2 }}
      updateConfig={vi.fn()}
      selected={false}
    />,
  );
}

beforeEach(() => {
  useExecutionStore.setState({ records: new Map() });
});

afterEach(() => {
  useExecutionStore.setState({ records: new Map() });
});

describe("image-grid body — click to preview", () => {
  it("shows a clickable preview trigger once a grid is composed", () => {
    seedRecord("grid_1", {
      status: "done",
      output: { type: "image", value: { url: "https://x/grid.png" } },
    });
    renderBody();
    expect(screen.getByRole("button", { name: /Preview grid/ })).toBeTruthy();
    // Modal is not mounted until the trigger is clicked.
    expect(screen.queryByTestId("image-preview-modal")).toBeNull();
  });

  it("opens the preview modal when the composed image is clicked", () => {
    seedRecord("grid_1", {
      status: "done",
      output: { type: "image", value: { url: "https://x/grid.png" } },
    });
    renderBody();
    fireEvent.click(screen.getByRole("button", { name: /Preview grid/ }));
    const modal = screen.getByTestId("image-preview-modal");
    expect(modal).toBeTruthy();
    const img = screen.getByAltText("Image grid") as HTMLImageElement;
    expect(img.src).toContain("https://x/grid.png");
  });

  it("does not render a preview trigger before a run", () => {
    renderBody();
    expect(screen.queryByRole("button", { name: /Preview grid/ })).toBeNull();
  });
});

describe("image-grid body — multi-page navigation", () => {
  function seedPages(nodeId: string, urls: string[]) {
    seedRecord(nodeId, {
      status: "done",
      output: urls.map((url) => ({ type: "image", value: { url } })),
    });
  }

  it("shows a page cursor when the run produced multiple grids", () => {
    seedPages("grid_1", [
      "https://x/p1.png",
      "https://x/p2.png",
      "https://x/p3.png",
    ]);
    renderBody();
    expect(screen.getByTestId("iterator-cursor-counter").textContent).toBe(
      "1 / 3",
    );
  });

  it("steps to the next page and previews the focused page", () => {
    seedPages("grid_1", ["https://x/p1.png", "https://x/p2.png"]);
    renderBody();

    // Initial page is the first grid.
    expect(
      (screen.getByAltText("Grid page 1") as HTMLImageElement).src,
    ).toContain("https://x/p1.png");

    fireEvent.click(
      screen.getByRole("button", { name: /Grid page next item/ }),
    );

    expect(
      (screen.getByAltText("Grid page 2") as HTMLImageElement).src,
    ).toContain("https://x/p2.png");

    // The modal opens on the focused page, not page 1.
    fireEvent.click(
      screen.getByRole("button", { name: /Preview grid page 2 of 2/ }),
    );
    const modalImg = screen.getByAltText("Image grid page 2") as HTMLImageElement;
    expect(modalImg.src).toContain("https://x/p2.png");
  });

  it("renders no page cursor for a single-grid run", () => {
    seedRecord("grid_1", {
      status: "done",
      output: { type: "image", value: { url: "https://x/solo.png" } },
    });
    renderBody();
    expect(screen.queryByTestId("iterator-cursor")).toBeNull();
  });
});
