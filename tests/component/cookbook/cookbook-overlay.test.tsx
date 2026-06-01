import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const recipeRepoMocks = {
  list: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
};

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => recipeRepoMocks,
  SupabaseRecipeRepository: class {},
}));

const pushMock = vi.hoisted(() => vi.fn());

// `recipe-detail.tsx` calls `useRouter().push` for the Edit button —
// happy-dom doesn't ship a Next router context, so stub it here.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}));

const sessionMock = vi.hoisted(() => ({
  user: { id: "user-1", email: "u@example.com" },
}));

vi.mock("@/lib/auth/use-session", () => ({
  useSession: () => sessionMock,
}));

const { CookbookOverlay } = await import(
  "@/components/cookbook/cookbook-overlay"
);
const { useLayoutStore } = await import("@/lib/stores/layout-store");

import { TooltipProvider } from "@/components/ui/tooltip";
import type { RecipeRecord } from "@/lib/repositories/recipe-repository";

function withTooltip(node: React.ReactNode) {
  return <TooltipProvider>{node}</TooltipProvider>;
}

function seedRecipe(overrides: Partial<RecipeRecord> = {}): RecipeRecord {
  return {
    id: overrides.id ?? "r1",
    ownerId: overrides.ownerId ?? null,
    name: overrides.name ?? "Seedance Prompt Director",
    description: overrides.description ?? "Generate polished Seedance prompts.",
    category: overrides.category ?? "prompt-engineering",
    subgraph: overrides.subgraph ?? {
      version: 2,
      nodes: [
        {
          id: "t1",
          kind: "text",
          position: { x: 0, y: 0 },
          config: {
            text: "You are a director crafting one-shot Seedance prompts. Be specific.",
          },
        },
        {
          id: "llm",
          kind: "llm-text",
          position: { x: 0, y: 0 },
          config: { model: "anthropic/claude-sonnet-4.5", temperature: 0.7 },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "t1",
          sourceHandle: "out",
          target: "llm",
          targetHandle: "system",
        },
      ],
      exposedInputs: [
        {
          internalNodeId: "t1",
          internalHandleId: "var-briefing",
          label: "briefing",
          dataType: "text",
        },
      ],
      exposedOutputs: [
        {
          internalNodeId: "llm",
          internalHandleId: "out",
          label: "prompt",
          dataType: "text",
        },
      ],
      exposedParams: [],
    },
    isNode: true,
    parentRecipeId: null,
    createdAt: "2026-06-01T00:00:00Z",
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(recipeRepoMocks).forEach((m) => m.mockReset());
  recipeRepoMocks.list.mockResolvedValue([
    seedRecipe(),
    seedRecipe({
      id: "r2",
      ownerId: "user-1",
      name: "My Custom Recipe",
      description: "A user-owned recipe.",
    }),
  ]);
  useLayoutStore.setState({ cookbookOpen: false, cookbookTab: "recipes" });
});

afterEach(() => {
  useLayoutStore.setState({ cookbookOpen: false });
});

describe("CookbookOverlay (Phase A)", () => {
  it("renders nothing when closed", () => {
    render(withTooltip(<CookbookOverlay />));
    expect(screen.queryByTestId("cookbook-overlay")).toBeNull();
  });

  it("renders the overlay with both tabs when opened", async () => {
    useLayoutStore.setState({ cookbookOpen: true });
    render(withTooltip(<CookbookOverlay />));
    expect(screen.getByTestId("cookbook-overlay")).toBeTruthy();
    expect(screen.getByTestId("cookbook-tab-recipes")).toBeTruthy();
    expect(screen.getByTestId("cookbook-tab-prompts")).toBeTruthy();
    // Recipes tab default
    await waitFor(() => {
      expect(
        screen.getByTestId("cookbook-recipe-card-r1"),
      ).toBeTruthy();
    });
  });

  it("closes when Esc is pressed", async () => {
    useLayoutStore.setState({ cookbookOpen: true });
    render(withTooltip(<CookbookOverlay />));
    expect(useLayoutStore.getState().cookbookOpen).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(useLayoutStore.getState().cookbookOpen).toBe(false);
    });
  });

  it("closes when backdrop is clicked", async () => {
    useLayoutStore.setState({ cookbookOpen: true });
    render(withTooltip(<CookbookOverlay />));
    const backdrops = screen.getAllByLabelText("Close Cookbook");
    // The first one is the backdrop, the second the close button.
    fireEvent.click(backdrops[0]!);
    await waitFor(() => {
      expect(useLayoutStore.getState().cookbookOpen).toBe(false);
    });
  });

  it("filters recipes by ownership chip", async () => {
    useLayoutStore.setState({ cookbookOpen: true });
    render(withTooltip(<CookbookOverlay />));
    await waitFor(() => {
      expect(screen.getByTestId("cookbook-recipe-card-r1")).toBeTruthy();
      expect(screen.getByTestId("cookbook-recipe-card-r2")).toBeTruthy();
    });
    // Click "Yours" chip — system recipe (r1) should disappear.
    fireEvent.click(screen.getByText("Yours"));
    await waitFor(() => {
      expect(screen.queryByTestId("cookbook-recipe-card-r1")).toBeNull();
      expect(screen.getByTestId("cookbook-recipe-card-r2")).toBeTruthy();
    });
  });

  it("auto-selects the first recipe and shows its detail panel", async () => {
    useLayoutStore.setState({ cookbookOpen: true });
    render(withTooltip(<CookbookOverlay />));
    await waitFor(() => {
      expect(screen.getByTestId("cookbook-recipe-drop")).toBeTruthy();
      expect(screen.getByTestId("cookbook-recipe-duplicate")).toBeTruthy();
    });
  });

  it("shows the system recipe's internal prompt with a copy button", async () => {
    useLayoutStore.setState({ cookbookOpen: true });
    render(withTooltip(<CookbookOverlay />));
    await waitFor(() => {
      // The Seedance recipe's text-node body bleeds into the detail panel.
      expect(
        screen.getByText(/director crafting one-shot Seedance prompts/i),
      ).toBeTruthy();
    });
    // Copy buttons surface for the prompt content.
    const copyButtons = screen.getAllByTestId("cookbook-copy-button");
    expect(copyButtons.length).toBeGreaterThan(0);
  });

  it("clicking the Prompts tab updates the layout store", async () => {
    useLayoutStore.setState({ cookbookOpen: true, cookbookTab: "recipes" });
    render(withTooltip(<CookbookOverlay />));
    await waitFor(() => {
      expect(screen.getByTestId("cookbook-recipe-card-r1")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("cookbook-tab-prompts"));
    await waitFor(() => {
      expect(useLayoutStore.getState().cookbookTab).toBe("prompts");
    });
  });
});
