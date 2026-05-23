import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { IteratorCursor } from "@/components/nodes/iterator-cursor";

describe("<IteratorCursor />", () => {
  it("renders the 1-indexed counter (humans count from 1, cursors from 0)", () => {
    render(
      <IteratorCursor count={4} cursor={2} onCursorChange={vi.fn()} />,
    );
    // cursor=2 (0-indexed) → "3 / 4" displayed
    expect(screen.getByTestId("iterator-cursor-counter").textContent).toBe(
      "3 / 4",
    );
  });

  it("renders '0 / 0' when count is 0 (and both arrows are disabled)", () => {
    render(
      <IteratorCursor count={0} cursor={0} onCursorChange={vi.fn()} />,
    );
    expect(screen.getByTestId("iterator-cursor-counter").textContent).toBe(
      "0 / 0",
    );
    expect(
      screen.getByRole("button", { name: /previous item/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /next item/i }),
    ).toBeDisabled();
  });

  it("clicking right calls onCursorChange with cursor + 1", () => {
    const onCursorChange = vi.fn();
    render(
      <IteratorCursor
        count={4}
        cursor={1}
        onCursorChange={onCursorChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /next item/i }));
    expect(onCursorChange).toHaveBeenCalledWith(2);
  });

  it("clicking left calls onCursorChange with cursor - 1", () => {
    const onCursorChange = vi.fn();
    render(
      <IteratorCursor
        count={4}
        cursor={2}
        onCursorChange={onCursorChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /previous item/i }));
    expect(onCursorChange).toHaveBeenCalledWith(1);
  });

  it("clamps at the upper bound — right arrow disabled at the last item", () => {
    const onCursorChange = vi.fn();
    render(
      <IteratorCursor
        count={4}
        cursor={3}
        onCursorChange={onCursorChange}
      />,
    );
    const next = screen.getByRole("button", { name: /next item/i });
    expect(next).toBeDisabled();
    fireEvent.click(next);
    expect(onCursorChange).not.toHaveBeenCalled();
  });

  it("clamps at the lower bound — left arrow disabled at the first item", () => {
    const onCursorChange = vi.fn();
    render(
      <IteratorCursor
        count={4}
        cursor={0}
        onCursorChange={onCursorChange}
      />,
    );
    const back = screen.getByRole("button", { name: /previous item/i });
    expect(back).toBeDisabled();
    fireEvent.click(back);
    expect(onCursorChange).not.toHaveBeenCalled();
  });

  it("snaps an out-of-range cursor down to N-1 in the rendered counter (defensive)", () => {
    // A bogus cursor (e.g. user shrunk the assetIds array but cursor
    // didn't reset) doesn't crash the chip — it renders the highest
    // valid index instead.
    render(
      <IteratorCursor count={4} cursor={99} onCursorChange={vi.fn()} />,
    );
    expect(screen.getByTestId("iterator-cursor-counter").textContent).toBe(
      "4 / 4",
    );
  });

  it("disables both arrows when count is 1 (no navigation possible)", () => {
    render(
      <IteratorCursor count={1} cursor={0} onCursorChange={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: /previous item/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /next item/i }),
    ).toBeDisabled();
  });
});
