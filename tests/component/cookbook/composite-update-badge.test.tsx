import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).getAnimations = function () {
    return [];
  };
}

const updateInstanceMock = vi.hoisted(() => vi.fn());
const updateAllMock = vi.hoisted(() => vi.fn());
const countMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/recipes/update-composite", () => ({
  updateCompositeInstance: updateInstanceMock,
  updateAllCompositesByRecipe: updateAllMock,
  countCompositesByRecipe: countMock,
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const { CompositeUpdateBadge } = await import(
  "@/components/nodes/composite-update-badge"
);
const { useRecipeWatcherStore } = await import(
  "@/lib/stores/recipe-watcher-store"
);

beforeEach(() => {
  useRecipeWatcherStore.setState({
    versions: new Map(),
    hydrated: true,
    refreshCycle: 0,
  });
  countMock.mockReturnValue(1);
});

afterEach(() => {
  updateInstanceMock.mockReset();
  updateAllMock.mockReset();
  countMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.warning.mockReset();
});

describe("CompositeUpdateBadge", () => {
  it("renders the trigger pill with current version label", () => {
    render(
      <CompositeUpdateBadge
        nodeId="node-1"
        recipeId="r-1"
        instanceVersion={1}
        currentVersion={3}
      />,
    );
    const trigger = screen.getByTestId("composite-update-badge");
    expect(trigger.textContent).toMatch(/v3 available/i);
    expect(trigger.getAttribute("title")).toMatch(/v3/);
    expect(trigger.getAttribute("title")).toMatch(/v1/);
  });

  it("clicking the trigger opens the popover with both update buttons when totalInstances > 1", async () => {
    countMock.mockReturnValue(3);
    render(
      <CompositeUpdateBadge
        nodeId="node-1"
        recipeId="r-1"
        instanceVersion={1}
        currentVersion={3}
      />,
    );
    fireEvent.click(screen.getByTestId("composite-update-badge"));
    await waitFor(() => {
      expect(screen.getByTestId("composite-update-this")).toBeTruthy();
      expect(screen.getByTestId("composite-update-all")).toBeTruthy();
    });
    expect(screen.getByTestId("composite-update-all").textContent).toMatch(
      /3 instances/,
    );
  });

  it("hides Update All when there's only one instance of the recipe in the project", async () => {
    countMock.mockReturnValue(1);
    render(
      <CompositeUpdateBadge
        nodeId="node-1"
        recipeId="r-1"
        instanceVersion={1}
        currentVersion={3}
      />,
    );
    fireEvent.click(screen.getByTestId("composite-update-badge"));
    await waitFor(() => {
      expect(screen.getByTestId("composite-update-this")).toBeTruthy();
    });
    expect(screen.queryByTestId("composite-update-all")).toBeNull();
  });

  it("clicking 'Update this instance' calls updateCompositeInstance and toasts success", async () => {
    updateInstanceMock.mockResolvedValue({
      ok: true,
      preservedOverrides: 0,
      droppedOverrides: 0,
    });
    render(
      <CompositeUpdateBadge
        nodeId="node-1"
        recipeId="r-1"
        instanceVersion={1}
        currentVersion={3}
      />,
    );
    fireEvent.click(screen.getByTestId("composite-update-badge"));
    await waitFor(() => screen.getByTestId("composite-update-this"));
    fireEvent.click(screen.getByTestId("composite-update-this"));
    await waitFor(() => {
      expect(updateInstanceMock).toHaveBeenCalledWith({ nodeId: "node-1" });
    });
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalled();
    });
  });

  it("warns (instead of success) when overrides were dropped during update", async () => {
    updateInstanceMock.mockResolvedValue({
      ok: true,
      preservedOverrides: 1,
      droppedOverrides: 2,
    });
    render(
      <CompositeUpdateBadge
        nodeId="node-1"
        recipeId="r-1"
        instanceVersion={1}
        currentVersion={3}
      />,
    );
    fireEvent.click(screen.getByTestId("composite-update-badge"));
    await waitFor(() => screen.getByTestId("composite-update-this"));
    fireEvent.click(screen.getByTestId("composite-update-this"));
    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalled();
    });
    expect(toastMock.warning.mock.calls[0]![0]).toMatch(/2/);
    expect(toastMock.warning.mock.calls[0]![0]).toMatch(/dropped/);
  });

  it("clicking 'Update all instances' calls updateAllCompositesByRecipe with the recipe id", async () => {
    countMock.mockReturnValue(2);
    updateAllMock.mockResolvedValue({
      ok: true,
      updatedCount: 2,
      preservedOverrides: 0,
      droppedOverrides: 0,
    });
    render(
      <CompositeUpdateBadge
        nodeId="node-1"
        recipeId="r-1"
        instanceVersion={1}
        currentVersion={3}
      />,
    );
    fireEvent.click(screen.getByTestId("composite-update-badge"));
    await waitFor(() => screen.getByTestId("composite-update-all"));
    fireEvent.click(screen.getByTestId("composite-update-all"));
    await waitFor(() => {
      expect(updateAllMock).toHaveBeenCalledWith({ recipeId: "r-1" });
    });
  });
});
