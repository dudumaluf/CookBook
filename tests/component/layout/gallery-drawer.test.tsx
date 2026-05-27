import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const repoMocks = {
  list: vi.fn(),
  get: vi.fn(),
  insert: vi.fn(),
  listForNode: vi.fn(),
  setPinned: vi.fn(),
  setTitle: vi.fn(),
  setTags: vi.fn(),
  remove: vi.fn(),
};

vi.mock("@/lib/repositories/supabase-generation-repository", () => ({
  getGenerationRepository: () => repoMocks,
  SupabaseGenerationRepository: class {},
}));

const { GalleryDrawer } = await import(
  "@/components/layout/gallery-drawer"
);
const { useLayoutStore } = await import("@/lib/stores/layout-store");
const { useProjectStore } = await import("@/lib/stores/project-store");

import { TooltipProvider } from "@/components/ui/tooltip";
import type { GenerationRecord } from "@/lib/repositories/generation-repository";

function withTooltip(node: React.ReactNode) {
  return <TooltipProvider>{node}</TooltipProvider>;
}

function seedRecords(rows: GenerationRecord[]) {
  repoMocks.list.mockResolvedValue(rows);
}

function rec(
  id: string,
  overrides: Partial<GenerationRecord> = {},
): GenerationRecord {
  return {
    id,
    projectId: "p1",
    ownerId: "u1",
    nodeId: `n-${id}`,
    nodeKind: "higgsfield-image-gen",
    runId: 1,
    output: {
      type: "image",
      value: { url: `https://supabase.test/${id}.png` },
    },
    usage: null,
    inputsSnapshot: null,
    promptText: `prompt ${id}`,
    title: null,
    pinned: false,
    tags: [],
    createdAt: "2026-05-27T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(repoMocks).forEach((m) => m.mockReset());
  repoMocks.list.mockResolvedValue([]);
  useProjectStore.setState({ id: "p1", name: "T" });
  useLayoutStore.setState({ galleryOpen: true });
});

afterEach(() => {
  useLayoutStore.setState({ galleryOpen: false });
});

describe("GalleryDrawer (Slice 6.5)", () => {
  it("renders filter chips and shows all by default", async () => {
    seedRecords([rec("a"), rec("b")]);
    render(withTooltip(<GalleryDrawer />));
    await waitFor(() => {
      expect(screen.getByTestId("gallery-tab-all")).toBeTruthy();
      expect(screen.getByTestId("gallery-tab-image")).toBeTruthy();
      expect(screen.getByTestId("gallery-tab-text")).toBeTruthy();
      expect(screen.getByTestId("gallery-tab-video")).toBeTruthy();
      expect(screen.getByTestId("gallery-tab-pinned")).toBeTruthy();
    });
    // Default tab is "all".
    expect(
      screen.getByTestId("gallery-tab-all").getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("clicking a filter chip switches the active tab", async () => {
    seedRecords([rec("a")]);
    render(withTooltip(<GalleryDrawer />));
    await waitFor(() => {
      expect(screen.getByTestId("gallery-tab-image")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("gallery-tab-image"));
    expect(
      screen.getByTestId("gallery-tab-image").getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("gallery-tab-all").getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("cmd-clicking a card toggles selection and shows the bulk bar", async () => {
    seedRecords([rec("a"), rec("b")]);
    render(withTooltip(<GalleryDrawer />));
    await waitFor(() => {
      const cards = screen.getAllByTestId("gallery-card");
      expect(cards).toHaveLength(2);
    });
    const cards = screen.getAllByTestId("gallery-card");
    // Cmd-click first card → selection of 1, bulk bar shows.
    fireEvent.click(cards[0]!, { metaKey: true });
    expect(screen.getByTestId("gallery-bulk-bar")).toBeTruthy();
    expect(cards[0]!.getAttribute("data-selected")).toBe("true");
    // Cmd-click again → deselect.
    fireEvent.click(cards[0]!, { metaKey: true });
    expect(screen.queryByTestId("gallery-bulk-bar")).toBeNull();
  });

  it("plain-click on a card opens the lightbox (selection cleared)", async () => {
    seedRecords([rec("a"), rec("b")]);
    render(withTooltip(<GalleryDrawer />));
    await waitFor(() => {
      expect(screen.getAllByTestId("gallery-card")).toHaveLength(2);
    });
    const cards = screen.getAllByTestId("gallery-card");
    fireEvent.click(cards[0]!);
    expect(screen.getByTestId("gallery-lightbox")).toBeTruthy();
    // Selection didn't accumulate.
    expect(screen.queryByTestId("gallery-bulk-bar")).toBeNull();
  });

  it("count chip on tab matches the filtered length", async () => {
    seedRecords([
      rec("a", { pinned: true }),
      rec("b"),
      rec("c", {
        nodeKind: "llm-text",
        output: { type: "text", value: "hi" },
      }),
    ]);
    render(withTooltip(<GalleryDrawer />));
    await waitFor(() => {
      expect(screen.getAllByTestId("gallery-card")).toHaveLength(3);
    });
    // The "All" chip shows 3, the "Pinned" chip shows 1 (computed locally
    // from data — counts are for the parent's full result set).
    expect(screen.getByTestId("gallery-tab-all").textContent).toContain("3");
    expect(screen.getByTestId("gallery-tab-pinned").textContent).toContain(
      "1",
    );
  });
});

describe("GalleryLightbox via drawer (Slice 6.5)", () => {
  it("ArrowRight navigates to the next item, ArrowLeft to previous", async () => {
    seedRecords([rec("a"), rec("b"), rec("c")]);
    render(withTooltip(<GalleryDrawer />));
    await waitFor(() => {
      expect(screen.getAllByTestId("gallery-card")).toHaveLength(3);
    });
    fireEvent.click(screen.getAllByTestId("gallery-card")[0]!);
    const lightbox = screen.getByTestId("gallery-lightbox");
    expect(lightbox.textContent).toContain("1 / 3");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("gallery-lightbox").textContent).toContain(
      "2 / 3",
    );
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("gallery-lightbox").textContent).toContain(
      "1 / 3",
    );
  });

  it("Esc closes the lightbox without closing the drawer", async () => {
    seedRecords([rec("a")]);
    render(withTooltip(<GalleryDrawer />));
    await waitFor(() => {
      expect(screen.getAllByTestId("gallery-card")).toHaveLength(1);
    });
    fireEvent.click(screen.getAllByTestId("gallery-card")[0]!);
    expect(screen.getByTestId("gallery-lightbox")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("gallery-lightbox")).toBeNull();
    // Drawer stays open.
    expect(useLayoutStore.getState().galleryOpen).toBe(true);
  });
});
