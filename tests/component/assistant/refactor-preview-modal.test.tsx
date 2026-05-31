import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import "@/lib/engine/all-nodes";
import { RefactorPreviewModal } from "@/components/assistant/refactor-preview-modal";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import type { PendingRefactor } from "@/lib/assistant/refactor-types";

/**
 * `RefactorPreviewModal` — Phase 3.
 *
 * Subscribes to `pendingRefactor` and renders the proposal as a diff
 * with three buttons (apply / cancel / edit-in-chat). On apply, the
 * dispatcher mutates the store; rollback on failure is covered by the
 * `refactor-apply` unit tests — this file focuses on the UI contract.
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function pending(
  ops: PendingRefactor["operations"],
  overrides: Partial<PendingRefactor> = {},
): PendingRefactor {
  return {
    id: "r_test",
    summary: "Test refactor",
    operations: ops,
    status: "pending",
    proposedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useAssistantStore.setState({
    messages: [],
    isThinking: false,
    abortController: null,
    liveEvents: [],
    pendingQuestion: null,
    pendingRefactor: null,
  });
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
  });
  useLayoutStore.setState({
    chatSheetOpen: false,
    libraryOpen: false,
    queueOpen: false,
  } as never);
});

afterEach(() => {
  cleanup();
});

describe("<RefactorPreviewModal /> — visibility", () => {
  it("renders nothing when there is no pending refactor", () => {
    const { container } = render(<RefactorPreviewModal />);
    expect(container.firstChild).toBeNull();
  });

  it("opens when the assistant store gets a pending refactor", () => {
    useAssistantStore.setState({
      pendingRefactor: pending([
        { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
      ]),
    });
    render(<RefactorPreviewModal />);
    expect(screen.getByTestId("refactor-preview-modal")).toBeInTheDocument();
    expect(screen.getByText("Apply assistant refactor?")).toBeInTheDocument();
    expect(screen.getByText("Test refactor")).toBeInTheDocument();
  });
});

describe("<RefactorPreviewModal /> — op rendering", () => {
  it("renders one row per operation", () => {
    useAssistantStore.setState({
      pendingRefactor: pending([
        { op: "add_node", kind: "text", position: { x: 50, y: 50 } },
        { op: "remove_node", nodeId: "old1" },
        {
          op: "add_edge",
          source: "a",
          sourceHandle: "out",
          target: "b",
          targetHandle: "user",
        },
      ]),
    });
    render(<RefactorPreviewModal />);
    const list = screen.getByTestId("refactor-preview-ops");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(screen.getByTestId("refactor-op-0")).toBeInTheDocument();
    expect(screen.getByTestId("refactor-op-1")).toBeInTheDocument();
    expect(screen.getByTestId("refactor-op-2")).toBeInTheDocument();
  });

  it("describes adds, removes, edges in human language", () => {
    useAssistantStore.setState({
      pendingRefactor: pending([
        { op: "add_node", clientId: "c1", kind: "text", position: { x: 5, y: 5 } },
        { op: "remove_node", nodeId: "old1" },
        {
          op: "add_edge",
          source: "c1",
          sourceHandle: "out",
          target: "downstream",
          targetHandle: "user",
        },
        {
          op: "update_node_config",
          nodeId: "alpha",
          config: { text: "x" },
        },
      ]),
    });
    render(<RefactorPreviewModal />);
    const list = screen.getByTestId("refactor-preview-ops");
    expect(within(list).getByText(/Add/i)).toBeInTheDocument();
    expect(within(list).getByText(/Remove node/i)).toBeInTheDocument();
    expect(within(list).getByText(/Connect/i)).toBeInTheDocument();
    expect(within(list).getByText(/Update/i)).toBeInTheDocument();
  });
});

describe("<RefactorPreviewModal /> — apply path", () => {
  it("Apply All commits the operations + closes the modal", async () => {
    useAssistantStore.setState({
      pendingRefactor: pending([
        { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
      ]),
    });
    render(<RefactorPreviewModal />);
    fireEvent.click(screen.getByTestId("refactor-apply"));
    // Dispatcher runs synchronously inside applyRefactor. Wait for the
    // store to reach `applied`, then for auto-clear to null it.
    await waitFor(() => {
      expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    });
    await waitFor(() => {
      expect(useAssistantStore.getState().pendingRefactor).toBeNull();
    });
  });

  it("renders error + keeps modal open on apply failure", async () => {
    useAssistantStore.setState({
      pendingRefactor: pending([
        { op: "remove_node", nodeId: "non-existent" },
      ]),
    });
    render(<RefactorPreviewModal />);
    fireEvent.click(screen.getByTestId("refactor-apply"));
    // After the failure the modal stays open with status: "failed" and
    // surfaces the error inline. Verify both signals.
    await waitFor(() => {
      const state = useAssistantStore.getState().pendingRefactor;
      expect(state?.status).toBe("failed");
    });
    expect(screen.getByTestId("refactor-error")).toBeInTheDocument();
  });
});

describe("<RefactorPreviewModal /> — cancel + edit paths", () => {
  it("Cancel clears the proposal without mutating the store", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", kind: "text", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
    useAssistantStore.setState({
      pendingRefactor: pending([
        { op: "remove_node", nodeId: "a" },
      ]),
    });
    render(<RefactorPreviewModal />);
    fireEvent.click(screen.getByTestId("refactor-cancel"));
    expect(useAssistantStore.getState().pendingRefactor).toBeNull();
    // Canvas untouched.
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
  });

  it("Edit in chat marks rejected, opens chat sheet, clears proposal", () => {
    useAssistantStore.setState({
      pendingRefactor: pending([
        { op: "add_node", kind: "text", position: { x: 0, y: 0 } },
      ]),
    });
    render(<RefactorPreviewModal />);
    fireEvent.click(screen.getByTestId("refactor-edit-in-chat"));
    expect(useAssistantStore.getState().pendingRefactor).toBeNull();
    expect(useLayoutStore.getState().chatSheetOpen).toBe(true);
  });
});
