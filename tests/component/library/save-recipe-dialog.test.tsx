import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
});
