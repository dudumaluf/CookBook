import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Base UI's ScrollArea internally calls `viewport.getAnimations()` from a
// timer callback after mount/unmount. happy-dom doesn't implement it.
// Stub a no-op so the timer fires harmlessly inside this test file.
if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).getAnimations = function () {
    return [];
  };
}

/**
 * Phase B1 — Edit button on `RecipeDetail`. Three flows:
 *   1. Anonymous user → toast "sign in", no navigation.
 *   2. User-owned recipe → router.push(/recipes/<id>/edit?from=<here>).
 *   3. System recipe → forkRecipe first, then router.push to fork id.
 */

const pushMock = vi.hoisted(() => vi.fn());
const forkMock = vi.hoisted(() => vi.fn());
const removeMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/recipes/fork-recipe", () => ({ forkRecipe: forkMock }));

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({ remove: removeMock }),
  SupabaseRecipeRepository: class {},
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const { RecipeDetail } = await import("@/components/cookbook/recipe-detail");
const { useLayoutStore } = await import("@/lib/stores/layout-store");

import { TooltipProvider } from "@/components/ui/tooltip";
import type { RecipeRecord } from "@/lib/repositories/recipe-repository";

function withTooltip(node: React.ReactNode) {
  return <TooltipProvider>{node}</TooltipProvider>;
}

function recipe(overrides: Partial<RecipeRecord> = {}): RecipeRecord {
  return {
    id: "r1",
    ownerId: "user-1",
    name: "My Recipe",
    description: "Test",
    category: "image",
    subgraph: {
      version: 2,
      nodes: [],
      edges: [],
      exposedInputs: [],
      exposedOutputs: [],
      exposedParams: [],
    },
    isNode: true,
    parentRecipeId: null,
    createdAt: "2026-06-01T00:00:00Z",
    version: 1,
    ...overrides,
  };
}

afterEach(() => {
  pushMock.mockReset();
  forkMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  useLayoutStore.setState({ cookbookOpen: true });
});

// happy-dom needs a window.location stub for the `?from=` derivation.
// JSDOM's defaults are fine; record the shape so we can assert on it.
function expectedFromQuery(): string {
  // Test environment defaults to http://localhost/ — pathname is "/".
  return `?from=${encodeURIComponent(window.location.pathname)}`;
}

describe("RecipeDetail — Edit button (Phase B1)", () => {
  it("user-owned: clicking Edit navigates to /recipes/<id>/edit with from=<here>", async () => {
    render(
      withTooltip(
        <RecipeDetail
          recipe={recipe()}
          userId="user-1"
          onChanged={vi.fn()}
        />,
      ),
    );
    const button = screen.getByTestId("cookbook-recipe-edit");
    expect(button.textContent).toMatch(/edit/i);
    expect(button.textContent).not.toMatch(/fork/i);
    fireEvent.click(button);
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledTimes(1);
    });
    expect(pushMock.mock.calls[0]![0]).toBe(
      `/recipes/r1/edit${expectedFromQuery()}`,
    );
    expect(forkMock).not.toHaveBeenCalled();
    // Cookbook overlay closes so the canvas re-takes the foreground.
    expect(useLayoutStore.getState().cookbookOpen).toBe(false);
  });

  it("system recipe: clicking Edit silently forks and navigates to the fork's id", async () => {
    forkMock.mockResolvedValue({
      ...recipe(),
      id: "r-fork",
      ownerId: "user-1",
      name: "My Recipe (your copy)",
    });
    const onChanged = vi.fn();
    render(
      withTooltip(
        <RecipeDetail
          recipe={recipe({ ownerId: null, name: "System Recipe" })}
          userId="user-1"
          onChanged={onChanged}
        />,
      ),
    );
    const button = screen.getByTestId("cookbook-recipe-edit");
    // Distinct label so the user knows what's about to happen.
    expect(button.textContent).toMatch(/fork/i);
    fireEvent.click(button);
    await waitFor(() => {
      expect(forkMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledTimes(1);
    });
    expect(forkMock.mock.calls[0]![0]).toMatchObject({
      ownerId: "user-1",
      nameSuffix: " (your copy)",
    });
    expect(pushMock.mock.calls[0]![0]).toBe(
      `/recipes/r-fork/edit${expectedFromQuery()}`,
    );
    // Library list refreshed so the fresh fork shows up on return.
    expect(onChanged).toHaveBeenCalled();
  });

  it("anonymous (no userId): Edit shows a toast and does not navigate", () => {
    render(
      withTooltip(
        <RecipeDetail
          recipe={recipe({ ownerId: null })}
          userId={null}
          onChanged={vi.fn()}
        />,
      ),
    );
    // Disabled when there's no userId — clicking should be a no-op even if
    // the disabled gate doesn't fire (defense in depth).
    const button = screen.getByTestId("cookbook-recipe-edit");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(pushMock).not.toHaveBeenCalled();
    expect(forkMock).not.toHaveBeenCalled();
  });

  it("Edit button sits between Drop and Duplicate in the action row", () => {
    render(
      withTooltip(
        <RecipeDetail
          recipe={recipe()}
          userId="user-1"
          onChanged={vi.fn()}
        />,
      ),
    );
    const drop = screen.getByTestId("cookbook-recipe-drop");
    const edit = screen.getByTestId("cookbook-recipe-edit");
    const dup = screen.getByTestId("cookbook-recipe-duplicate");
    // DOM order: drop → edit → duplicate.
    const actions = drop.parentElement;
    const idxs = ["cookbook-recipe-drop", "cookbook-recipe-edit", "cookbook-recipe-duplicate"].map(
      (tid) =>
        Array.from(actions!.children).findIndex(
          (c) => (c as HTMLElement).getAttribute("data-testid") === tid,
        ),
    );
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
    expect(idxs.every((i) => i >= 0)).toBe(true);
    void edit;
    void dup;
  });
});
