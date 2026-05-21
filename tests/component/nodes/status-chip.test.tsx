import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { NodeStatusChip } from "@/components/nodes/status-chip";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  _resetExecutionForTests,
  useExecutionStore,
} from "@/lib/stores/execution-store";
import type { ExecutionStatus } from "@/types/node";

afterEach(() => {
  _resetExecutionForTests();
  cleanup();
});

function withProvider(node: React.ReactNode) {
  return <TooltipProvider>{node}</TooltipProvider>;
}

function setStatus(nodeId: string, status: ExecutionStatus, extra: object = {}) {
  // Wrap in act() because mutating the store triggers subscribed-component
  // re-renders that we want React to flush before the assertions run.
  act(() => {
    const next = new Map(useExecutionStore.getState().records);
    next.set(nodeId, { status, ...extra });
    useExecutionStore.setState({ records: next });
  });
}

describe("NodeStatusChip", () => {
  it("renders nothing when no record exists (default idle)", () => {
    const { container } = render(
      withProvider(<NodeStatusChip nodeId="n1" />),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when status is explicitly idle", () => {
    setStatus("n1", "idle");
    const { container } = render(
      withProvider(<NodeStatusChip nodeId="n1" />),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the badge for each non-idle status with the right data-status attr", () => {
    const statuses: Exclude<ExecutionStatus, "idle">[] = [
      "pending",
      "running",
      "done",
      "cached",
      "error",
      "cancelled",
    ];
    for (const status of statuses) {
      setStatus("n1", status);
      const { unmount } = render(
        withProvider(<NodeStatusChip nodeId="n1" />),
      );
      const badge = screen.getByRole("status");
      expect(badge.getAttribute("data-status")).toBe(status);
      unmount();
    }
  });

  it("surfaces the elapsed time in the aria-label when done", () => {
    setStatus("n1", "done", { elapsedMs: 123 });
    render(withProvider(<NodeStatusChip nodeId="n1" />));
    const badge = screen.getByRole("status");
    expect(badge.getAttribute("aria-label")).toContain("123");
  });

  it("surfaces the error message in the aria-label when error", () => {
    setStatus("n1", "error", { error: "Boom" });
    render(withProvider(<NodeStatusChip nodeId="n1" />));
    const badge = screen.getByRole("status");
    expect(badge.getAttribute("aria-label")).toContain("Boom");
  });

  /* ──────────────────── Slice 5.1: fan-out counter ──────────────────── */

  it("renders an inline `done/total` counter beside the spinner during fan-out", () => {
    setStatus("n1", "running", { fanOut: { total: 8, done: 3 } });
    render(withProvider(<NodeStatusChip nodeId="n1" />));
    const counter = screen.getByTestId("status-chip-fanout-count");
    expect(counter.textContent).toBe("3/8");
  });

  it("surfaces the fan-out progress in the running tooltip / aria-label", () => {
    setStatus("n1", "running", { fanOut: { total: 4, done: 2 } });
    render(withProvider(<NodeStatusChip nodeId="n1" />));
    const badge = screen.getByRole("status");
    expect(badge.getAttribute("aria-label")).toContain("2/4");
  });

  it("does NOT render the counter on non-running statuses (final state shows the icon only)", () => {
    setStatus("n1", "done", {
      elapsedMs: 600,
      fanOut: { total: 4, done: 4 },
    });
    render(withProvider(<NodeStatusChip nodeId="n1" />));
    expect(screen.queryByTestId("status-chip-fanout-count")).toBeNull();
  });

  it("does NOT render the counter when running without fan-out (single execution)", () => {
    setStatus("n1", "running");
    render(withProvider(<NodeStatusChip nodeId="n1" />));
    expect(screen.queryByTestId("status-chip-fanout-count")).toBeNull();
  });
});
