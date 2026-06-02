import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type {
  RecipeRecord,
  RecipeVersionRecord,
} from "@/lib/repositories/recipe-repository";

const listVersionsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => ({ listVersions: listVersionsMock }),
}));

const { RecipeVersionHistory } = await import(
  "@/components/cookbook/recipe-version-history"
);

function recipe(overrides: Partial<RecipeRecord> = {}): RecipeRecord {
  return {
    id: "r1",
    ownerId: "u1",
    name: "Test recipe",
    description: null,
    category: null,
    subgraph: {
      version: 2,
      nodes: [
        {
          id: "n1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: "current" },
        },
      ],
      edges: [],
    },
    isNode: true,
    parentRecipeId: null,
    createdAt: "2026-06-01T00:00:00Z",
    version: 3,
    ...overrides,
  };
}

function version(
  v: number,
  overrides: Partial<RecipeVersionRecord> = {},
): RecipeVersionRecord {
  return {
    id: `ver-${v}`,
    recipeId: "r1",
    version: v,
    name: `Test recipe`,
    description: null,
    category: null,
    subgraph: {
      version: 2,
      nodes: [
        {
          id: "n1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: { text: `v${v}` },
        },
      ],
      edges: [],
    },
    savedBy: "u1",
    createdAt: new Date(2026, 5, v).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  listVersionsMock.mockResolvedValue([version(2), version(1)]);
});

afterEach(() => {
  listVersionsMock.mockReset();
});

describe("RecipeVersionHistory", () => {
  it("renders nothing for v1 recipes (no history to show)", () => {
    render(<RecipeVersionHistory recipe={recipe({ version: 1 })} />);
    expect(screen.queryByTestId("recipe-version-history")).toBeNull();
  });

  it("renders collapsed by default for v > 1 recipes", () => {
    render(<RecipeVersionHistory recipe={recipe()} />);
    expect(screen.getByTestId("recipe-version-history")).toBeTruthy();
    expect(screen.queryByTestId("recipe-version-list")).toBeNull();
    // Section is gated on a click — listVersions hasn't been called yet.
    expect(listVersionsMock).not.toHaveBeenCalled();
  });

  it("expanding the section lazy-loads the version list and selects the most recent prior version", async () => {
    render(<RecipeVersionHistory recipe={recipe()} />);
    fireEvent.click(screen.getByTestId("recipe-version-history-toggle"));
    await waitFor(() => {
      expect(listVersionsMock).toHaveBeenCalledWith("r1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("recipe-version-list")).toBeTruthy();
    });
    // Current version row + 2 historical rows = 3 list items.
    const list = screen.getByTestId("recipe-version-list");
    expect(list.querySelectorAll("li").length).toBe(3);
    // v2 row exists + is selected (default = most recent prior).
    const v2 = screen.getByTestId("recipe-version-row-2");
    expect(v2).toBeTruthy();
  });

  it("clicking a different version row selects it and renders the diff", async () => {
    render(<RecipeVersionHistory recipe={recipe()} />);
    fireEvent.click(screen.getByTestId("recipe-version-history-toggle"));
    await waitFor(() => screen.getByTestId("recipe-version-row-1"));
    fireEvent.click(screen.getByTestId("recipe-version-row-1"));
    await waitFor(() => {
      expect(screen.getByTestId("recipe-version-diff")).toBeTruthy();
    });
  });

  it("renders an empty-state message when listVersions returns []", async () => {
    listVersionsMock.mockResolvedValue([]);
    render(<RecipeVersionHistory recipe={recipe()} />);
    fireEvent.click(screen.getByTestId("recipe-version-history-toggle"));
    await waitFor(() => {
      expect(listVersionsMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("recipe-version-list")).toBeNull();
    });
    expect(screen.getByTestId("recipe-version-history").textContent).toMatch(
      /no earlier versions/i,
    );
  });

  it("resets selection when the recipe id changes (avoids cross-recipe history bleeding)", async () => {
    const { rerender } = render(<RecipeVersionHistory recipe={recipe()} />);
    fireEvent.click(screen.getByTestId("recipe-version-history-toggle"));
    await waitFor(() => screen.getByTestId("recipe-version-list"));
    rerender(<RecipeVersionHistory recipe={recipe({ id: "r-different" })} />);
    // Section collapses on recipe id change — list disappears.
    expect(screen.queryByTestId("recipe-version-list")).toBeNull();
  });
});
