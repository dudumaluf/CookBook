import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const repoMocks = {
  list: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  saveAsNewVersion: vi.fn(),
  listVersions: vi.fn(),
  getVersion: vi.fn(),
};

vi.mock("@/lib/repositories/supabase-recipe-repository", () => ({
  getRecipeRepository: () => repoMocks,
  SupabaseRecipeRepository: class {},
}));

vi.mock("@/lib/auth/use-session", () => ({
  useSession: () => ({ user: { id: "u1", email: "me@x.com" }, signOut: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/canvas/spawn-position", () => ({
  getSpawnPosition: () => ({ x: 0, y: 0 }),
}));

const { AddRecipeButton } = await import("@/components/layout/add-recipe-button");
const { useLayoutStore } = await import("@/lib/stores/layout-store");

import { TooltipProvider } from "@/components/ui/tooltip";
import type { RecipeRecord } from "@/lib/repositories/recipe-repository";

function withTooltip(node: React.ReactNode) {
  return <TooltipProvider>{node}</TooltipProvider>;
}

function seedRecipe(overrides: Partial<RecipeRecord> = {}): RecipeRecord {
  return {
    id: overrides.id ?? "r1",
    ownerId: overrides.ownerId !== undefined ? overrides.ownerId : null,
    name: overrides.name ?? "Image Describer",
    description: overrides.description ?? "Describe an image",
    category:
      overrides.category !== undefined ? overrides.category : "describe",
    subgraph: overrides.subgraph ?? {
      version: 2,
      nodes: [],
      edges: [],
    },
    isNode: overrides.isNode ?? true,
    parentRecipeId: overrides.parentRecipeId ?? null,
    createdAt: overrides.createdAt ?? "2026-06-04T00:00:00Z",
    version: overrides.version ?? 1,
  };
}

beforeEach(() => {
  Object.values(repoMocks).forEach((m) => m.mockReset());
  repoMocks.list.mockResolvedValue([]);
  useLayoutStore.setState({
    addRecipePopoverOpen: true,
    cookbookOpen: false,
  });
});

afterEach(() => {
  // Close the popover BEFORE cleanup() unmounts so @base-ui's scroll-area
  // cancels its animation timer cleanly (open-at-unmount floods the trace).
  useLayoutStore.setState({ addRecipePopoverOpen: false, cookbookOpen: false });
});

describe("<AddRecipeButton />", () => {
  it("groups recipes into category buckets sorted by the canonical taxonomy", async () => {
    repoMocks.list.mockResolvedValue([
      seedRecipe({ id: "r-img", name: "Image Variation Burst", category: "image" }),
      seedRecipe({ id: "r-desc", name: "Image Describer", category: "describe" }),
      seedRecipe({ id: "r-vid", name: "Performance Video", category: "video" }),
      seedRecipe({ id: "r-aud", name: "Voice Memo Storyboard", category: "audio" }),
      seedRecipe({ id: "r-util", name: "Storyboard from Script", category: "utility" }),
    ]);
    render(withTooltip(<AddRecipeButton />));

    await waitFor(() => {
      expect(screen.getByTestId("add-recipe-bucket-describe")).toBeTruthy();
    });
    expect(screen.getByTestId("add-recipe-bucket-image")).toBeTruthy();
    expect(screen.getByTestId("add-recipe-bucket-video")).toBeTruthy();
    expect(screen.getByTestId("add-recipe-bucket-audio")).toBeTruthy();
    expect(screen.getByTestId("add-recipe-bucket-utility")).toBeTruthy();

    const describe = screen.getByTestId("add-recipe-bucket-describe");
    expect(describe.textContent).toContain("describe");
    expect(describe.textContent).toContain("(1)");
  });

  it("filter chips narrow to system / yours and the count reflects the filter", async () => {
    repoMocks.list.mockResolvedValue([
      seedRecipe({ id: "r-sys", name: "System Recipe", ownerId: null }),
      seedRecipe({
        id: "r-mine",
        name: "Mine Recipe",
        ownerId: "u1",
        category: "image",
      }),
    ]);
    render(withTooltip(<AddRecipeButton />));

    await waitFor(() => {
      expect(screen.getByTestId("add-recipe-filter-all")).toBeTruthy();
    });
    expect(screen.getByTestId("add-recipe-filter-system")).toBeTruthy();
    expect(screen.getByTestId("add-recipe-filter-mine")).toBeTruthy();

    // Default = "all" — both buckets visible.
    expect(screen.queryByTestId("add-recipe-bucket-describe")).toBeTruthy();
    expect(screen.queryByTestId("add-recipe-bucket-image")).toBeTruthy();

    // Switch to "system" — only the null-ownerId one stays.
    fireEvent.click(screen.getByTestId("add-recipe-filter-system"));
    await waitFor(() => {
      expect(screen.queryByTestId("add-recipe-bucket-image")).toBeNull();
    });
    expect(screen.queryByTestId("add-recipe-bucket-describe")).toBeTruthy();

    // Switch to "mine" — flips.
    fireEvent.click(screen.getByTestId("add-recipe-filter-mine"));
    await waitFor(() => {
      expect(screen.queryByTestId("add-recipe-bucket-describe")).toBeNull();
    });
    expect(screen.queryByTestId("add-recipe-bucket-image")).toBeTruthy();
  });

  it("'Manage all in Cookbook (⌘B)' opens the cookbook overlay and closes the popover", async () => {
    repoMocks.list.mockResolvedValue([seedRecipe({ id: "r-sys" })]);
    render(withTooltip(<AddRecipeButton />));

    await waitFor(() => {
      expect(screen.getByTestId("add-recipe-view-all")).toBeTruthy();
    });
    expect(useLayoutStore.getState().cookbookOpen).toBe(false);

    fireEvent.click(screen.getByTestId("add-recipe-view-all"));

    expect(useLayoutStore.getState().cookbookOpen).toBe(true);
    expect(useLayoutStore.getState().addRecipePopoverOpen).toBe(false);
  });

  it("recipes whose DB category falls outside the enum land in the 'uncategorized' bucket", async () => {
    repoMocks.list.mockResolvedValue([
      seedRecipe({ id: "r-legacy", name: "Legacy Pre-enum", category: null }),
    ]);
    render(withTooltip(<AddRecipeButton />));

    await waitFor(() => {
      expect(screen.getByTestId("add-recipe-bucket-null")).toBeTruthy();
    });
  });

  it("shows an empty-state hint when there are no recipes at all", async () => {
    repoMocks.list.mockResolvedValue([]);
    render(withTooltip(<AddRecipeButton />));

    await waitFor(() => {
      expect(screen.getByText(/No recipes yet/i)).toBeTruthy();
    });
  });
});
