import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { NodeSchema } from "@/types/node";

// Deterministic catalog: the real registry pulls in every node module. We
// only care that categories render, picking spawns, and there's NO recipe UI.
const FAKE_SCHEMAS: Pick<
  NodeSchema,
  "kind" | "category" | "title" | "description" | "icon"
>[] = [
  {
    kind: "fake-input",
    category: "input",
    title: "Fake Input",
    description: "an input node",
    icon: () => null,
  },
  {
    kind: "fake-transform",
    category: "transform",
    title: "Fake Transform",
    description: "a transform node",
    icon: () => null,
  },
];

vi.mock("@/lib/engine/all-nodes", () => ({}));
vi.mock("@/lib/engine/registry", () => ({
  nodeRegistry: { list: () => FAKE_SCHEMAS },
}));
vi.mock("@/lib/canvas/spawn-position", () => ({
  getSpawnPosition: () => ({ x: 0, y: 0 }),
}));

const addNode = vi.fn();
vi.mock("@/lib/stores/workflow-store", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({ addNode, nodes: [] }),
}));

const { AddNodeButton } = await import("@/components/layout/add-node-button");
const { useLayoutStore } = await import("@/lib/stores/layout-store");

beforeEach(() => {
  addNode.mockReset();
  useLayoutStore.setState({ addNodePopoverOpen: true });
});

afterEach(() => {
  useLayoutStore.setState({ addNodePopoverOpen: false });
});

describe("<AddNodeButton /> (single nodes only)", () => {
  it("renders the catalog grouped by category", () => {
    render(<AddNodeButton />);
    expect(screen.getByText("Inputs")).toBeTruthy();
    expect(screen.getByText("Fake Input")).toBeTruthy();
    expect(screen.getByText("Transform")).toBeTruthy();
    expect(screen.getByText("Fake Transform")).toBeTruthy();
  });

  it("does NOT render recipe UI (recipes moved to AddRecipeButton)", () => {
    render(<AddNodeButton />);
    expect(screen.queryByText(/^Recipes \(/)).toBeNull();
    expect(screen.queryByLabelText("Filter recipes by ownership")).toBeNull();
  });

  it("picking a node spawns it and closes the popover", () => {
    render(<AddNodeButton />);
    fireEvent.click(screen.getByText("Fake Input"));
    expect(addNode).toHaveBeenCalledWith("fake-input", { x: 0, y: 0 });
    expect(useLayoutStore.getState().addNodePopoverOpen).toBe(false);
  });

  it("search narrows the catalog and shows a no-match hint", () => {
    render(<AddNodeButton />);
    fireEvent.change(screen.getByLabelText("Search nodes"), {
      target: { value: "zzzznotarealnode" },
    });
    expect(screen.getByText(/No matches for/i)).toBeTruthy();
    expect(screen.queryByText("Fake Input")).toBeNull();
  });
});
