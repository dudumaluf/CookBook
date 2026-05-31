import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import "@/lib/engine/all-nodes";
import { SaveRecipeDialog } from "@/components/library/save-recipe-dialog";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

vi.mock("@/lib/auth/use-session", () => ({
  useSession: () => ({ user: { id: "u1", email: "me@x.com" }, signOut: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [
      { id: "n1", kind: "text", position: { x: 0, y: 0 }, config: { text: "hi" } },
    ],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
});

afterEach(() => cleanup());

describe("<SaveRecipeDialog />", () => {
  it("mounts closed without an infinite render loop (regression: React #185)", () => {
    // Before the fix, a `useWorkflowStore((s) => s.nodes.filter(...))`
    // selector returned a fresh array every render -> useSyncExternalStore
    // looped -> crash. Rendering the (always-mounted) dialog must be safe.
    expect(() =>
      render(
        <SaveRecipeDialog
          open={false}
          onOpenChange={vi.fn()}
          selectedNodeIds={["n1"]}
        />,
      ),
    ).not.toThrow();
  });

  it("offers inner config fields as exposable controls when open", () => {
    render(
      <SaveRecipeDialog
        open
        onOpenChange={vi.fn()}
        selectedNodeIds={["n1"]}
      />,
    );
    expect(screen.getByText("Save selection as recipe")).toBeInTheDocument();
    // The text node's `text` config field is a candidate control.
    expect(screen.getByTestId("save-recipe-param-text")).toBeInTheDocument();
  });

  it("inherits the node's control (dropdown + options) when exposing a declared param", () => {
    // A Seedance node declares aspectRatio as a select with its ratio options.
    useWorkflowStore.setState({
      nodes: [
        {
          id: "s1",
          kind: "seedance-video",
          position: { x: 0, y: 0 },
          config: { aspectRatio: "16:9", resolution: "720p" },
        },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    render(
      <SaveRecipeDialog open onOpenChange={vi.fn()} selectedNodeIds={["s1"]} />,
    );
    const row = screen.getByTestId("save-recipe-param-aspectRatio");
    // Expose it.
    fireEvent.click(within(row).getByRole("checkbox"));
    // The control defaults to "select" (not text) — the dropdown is preserved.
    const control = within(row).getByRole("combobox") as HTMLSelectElement;
    expect(control.value).toBe("select");
    // And the options were pre-filled from the schema (e.g. 16:9).
    const optionsInput = within(row).getByLabelText(
      "Dropdown options for aspectRatio",
    ) as HTMLInputElement;
    expect(optionsInput.value).toContain("16:9");
  });

  it("caps height to viewport and scrolls the middle so footer stays visible", () => {
    // Regression: a 14-node selection produced 12+ inputs; without a max-h
    // on DialogContent the dialog grew past the viewport and clipped the
    // Save / Cancel buttons. The fix: dialog is a flex column with a
    // viewport-relative max-h, the middle wrapper is the only scroll
    // region, and header / footer stay pinned.
    render(
      <SaveRecipeDialog open onOpenChange={vi.fn()} selectedNodeIds={["n1"]} />,
    );
    const dialog = screen.getByTestId("save-recipe-dialog");
    // The dialog content itself caps height + uses flex column layout
    // (the global guard in `<DialogContent />`).
    expect(dialog.className).toContain("flex");
    expect(dialog.className).toContain("flex-col");
    expect(dialog.className).toMatch(/max-h-\[calc\(100dvh/);
    expect(dialog.className).toContain("overflow-hidden");

    // The Save / Cancel footer remains a direct child of the dialog so it
    // can stay pinned at the bottom regardless of body length.
    const submit = screen.getByTestId("save-recipe-submit");
    const footer = submit.closest("[data-slot='dialog-footer']");
    expect(footer).not.toBeNull();
    expect(footer?.parentElement).toBe(dialog);

    // The middle scroll region exists and is configured for "shrink-and-scroll"
    // (`flex-1 min-h-0 overflow-y-auto`) so a long inputs / outputs list
    // never pushes the footer off-screen.
    const nameInput = screen.getByTestId("save-recipe-name");
    const scrollWrapper = nameInput.closest("[class*='overflow-y-auto']");
    expect(scrollWrapper).not.toBeNull();
    expect(scrollWrapper?.className).toContain("flex-1");
    expect(scrollWrapper?.className).toContain("min-h-0");
  });
});
