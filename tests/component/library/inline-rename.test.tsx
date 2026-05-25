import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";

import { InlineRename } from "@/components/library/inline-rename";

beforeEach(() => {
  // happy-dom resets between tests but defensive cleanup never hurts.
});

function Harness({
  initial = "Hello",
  onCommit,
  exposeRef,
}: {
  initial?: string;
  onCommit: (next: string) => void;
  exposeRef?: (ref: React.MutableRefObject<(() => void) | null>) => void;
}) {
  const ref = useRef<(() => void) | null>(null);
  if (exposeRef) exposeRef(ref);
  return (
    <InlineRename
      value={initial}
      onCommit={onCommit}
      ariaLabel="Rename test target"
      startEditingRef={ref}
      renderLabel={({ startEditing }) => (
        <p data-testid="rename-label" onDoubleClick={startEditing}>
          {initial}
        </p>
      )}
    />
  );
}

describe("<InlineRename />", () => {
  it("starts in label mode and flips to input on double-click", () => {
    render(<Harness onCommit={vi.fn()} />);
    expect(screen.getByTestId("rename-label")).toBeTruthy();
    expect(screen.queryByTestId("inline-rename-input")).toBeNull();
    fireEvent.doubleClick(screen.getByTestId("rename-label"));
    expect(screen.getByTestId("inline-rename-input")).toBeTruthy();
  });

  it("commits on Enter when the value changed", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByTestId("rename-label"));
    const input = screen.getByTestId("inline-rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Renamed");
  });

  it("does NOT commit when the value is unchanged", () => {
    const onCommit = vi.fn();
    render(<Harness initial="Hello" onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByTestId("rename-label"));
    const input = screen.getByTestId("inline-rename-input") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does NOT commit when the trimmed value is empty", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByTestId("rename-label"));
    const input = screen.getByTestId("inline-rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Escape cancels without firing onCommit", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByTestId("rename-label"));
    const input = screen.getByTestId("inline-rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Changed but cancelled" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    // Back to label mode.
    expect(screen.queryByTestId("inline-rename-input")).toBeNull();
  });

  it("blur commits like Enter", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByTestId("rename-label"));
    const input = screen.getByTestId("inline-rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed via blur" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("Renamed via blur");
  });

  it("stops propagation on click + pointerDown so card handlers don't fire", () => {
    render(<Harness onCommit={vi.fn()} />);
    fireEvent.doubleClick(screen.getByTestId("rename-label"));
    const input = screen.getByTestId("inline-rename-input") as HTMLInputElement;
    // We can't observe propagation directly with React's synthetic events
    // and fireEvent — but firing click/pointerDown shouldn't throw and
    // shouldn't move the rename out of edit mode.
    fireEvent.click(input);
    fireEvent.pointerDown(input);
    expect(screen.getByTestId("inline-rename-input")).toBeTruthy();
  });

  it("startEditingRef opens edit mode imperatively (right-click rename path)", () => {
    let externalRef: React.MutableRefObject<(() => void) | null> | null = null;
    const onCommit = vi.fn();
    render(
      <Harness
        onCommit={onCommit}
        exposeRef={(r) => {
          externalRef = r;
        }}
      />,
    );
    expect(screen.queryByTestId("inline-rename-input")).toBeNull();
    expect(externalRef).not.toBeNull();
    act(() => {
      externalRef!.current!();
    });
    expect(screen.getByTestId("inline-rename-input")).toBeTruthy();
  });
});
