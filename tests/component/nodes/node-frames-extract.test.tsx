import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { framesExtractNodeSchema } from "@/components/nodes/node-frames-extract";
import type { ImageRef } from "@/types/node";

/**
 * Component coverage for the Frames Extract curation UI. The body reads
 * the cached frame set from `config.frames` (written by execute()), so
 * we can drive it purely through props — no execution-store wiring.
 */

const Body = framesExtractNodeSchema.Body;

const frames: ImageRef[] = [
  { url: "https://x/f0.png", width: 1920, height: 1080 },
  { url: "https://x/f1.png", width: 1920, height: 1080 },
  { url: "https://x/f2.png", width: 1920, height: 1080 },
];

function renderBody(
  config: Record<string, unknown>,
  updateConfig = vi.fn(),
) {
  render(
    <Body
      nodeId="frames_1"
      config={config}
      updateConfig={updateConfig}
      selected={false}
    />,
  );
  return updateConfig;
}

describe("frames-extract body — curation", () => {
  it("prompts to wire a video before any frames exist", () => {
    renderBody({ mode: "count", count: 4 });
    expect(screen.getByText(/Wire a video/)).toBeTruthy();
  });

  it("renders a thumbnail per cached frame with a kept count", () => {
    renderBody({ mode: "count", count: 3, frames });
    expect(screen.getByAltText("Frame 1")).toBeTruthy();
    expect(screen.getByAltText("Frame 2")).toBeTruthy();
    expect(screen.getByAltText("Frame 3")).toBeTruthy();
    expect(screen.getByText("3/3 kept")).toBeTruthy();
  });

  it("excluding a frame writes its index to config", () => {
    const updateConfig = renderBody({ mode: "count", count: 3, frames });
    fireEvent.click(screen.getByTestId("frames-toggle-1"));
    expect(updateConfig).toHaveBeenCalledWith({ excludedIndices: [1] });
  });

  it("reflects the excluded count and offers Keep all", () => {
    const updateConfig = renderBody({
      mode: "count",
      count: 3,
      frames,
      excludedIndices: [1],
    });
    expect(screen.getByText("2/3 kept")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Keep all/ }));
    expect(updateConfig).toHaveBeenCalledWith({ excludedIndices: [] });
  });

  it("clicking a thumbnail opens the single-frame view", () => {
    renderBody({ mode: "count", count: 3, frames });
    fireEvent.click(
      screen.getByRole("button", { name: /Preview frame 2 of 3/ }),
    );
    // Single view exposes a back-to-grid affordance + the Exclude action.
    expect(screen.getByRole("button", { name: /Back to grid/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Exclude this frame/ }),
    ).toBeTruthy();
  });

  it("re-including a previously excluded frame clears its index", () => {
    const updateConfig = renderBody({
      mode: "count",
      count: 3,
      frames,
      excludedIndices: [0, 2],
    });
    // Toggle index 0 back on → only 2 remains excluded.
    fireEvent.click(screen.getByTestId("frames-toggle-0"));
    expect(updateConfig).toHaveBeenCalledWith({ excludedIndices: [2] });
  });
});
