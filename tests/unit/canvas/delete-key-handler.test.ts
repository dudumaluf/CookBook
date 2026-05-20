import { describe, expect, it, vi } from "vitest";

import { tryHandleDeleteKey } from "@/components/canvas/canvas-flow";

interface MockStateOptions {
  selectedNodeIds?: readonly string[];
  selectedEdgeIds?: readonly string[];
  removeNode?: (id: string) => void;
  removeEdge?: (id: string) => void;
}

function mockState(opts: MockStateOptions = {}) {
  return {
    selectedNodeIds: opts.selectedNodeIds ?? [],
    selectedEdgeIds: opts.selectedEdgeIds ?? [],
    removeNode: opts.removeNode ?? vi.fn(),
    removeEdge: opts.removeEdge ?? vi.fn(),
  };
}

function makeEvent(opts: {
  key: string;
  target?: { tagName?: string; isContentEditable?: boolean };
}): KeyboardEvent {
  // Hand-rolled KeyboardEvent stand-in — happy-dom's `new KeyboardEvent`
  // doesn't let us swap `target` after dispatch, and we don't want to
  // actually mount anything. Only the three fields the handler reads.
  return {
    key: opts.key,
    target: opts.target ?? null,
  } as unknown as KeyboardEvent;
}

describe("tryHandleDeleteKey", () => {
  it("returns false for non-delete keys", () => {
    const removeNode = vi.fn();
    const handled = tryHandleDeleteKey(makeEvent({ key: "a" }), () =>
      mockState({ selectedNodeIds: ["n1"], removeNode }),
    );
    expect(handled).toBe(false);
    expect(removeNode).not.toHaveBeenCalled();
  });

  it("returns false when nothing (nodes OR edges) is selected", () => {
    const removeNode = vi.fn();
    const removeEdge = vi.fn();
    const handled = tryHandleDeleteKey(
      makeEvent({ key: "Backspace" }),
      () => mockState({ removeNode, removeEdge }),
    );
    expect(handled).toBe(false);
    expect(removeNode).not.toHaveBeenCalled();
    expect(removeEdge).not.toHaveBeenCalled();
  });

  it("calls removeNode for each selected node id on Backspace", () => {
    const removeNode = vi.fn();
    const handled = tryHandleDeleteKey(
      makeEvent({ key: "Backspace" }),
      () => mockState({ selectedNodeIds: ["n1", "n2"], removeNode }),
    );
    expect(handled).toBe(true);
    expect(removeNode).toHaveBeenCalledTimes(2);
    expect(removeNode).toHaveBeenCalledWith("n1");
    expect(removeNode).toHaveBeenCalledWith("n2");
  });

  it("calls removeEdge for each selected edge id (NEW: edge selection delete)", () => {
    const removeEdge = vi.fn();
    const handled = tryHandleDeleteKey(
      makeEvent({ key: "Backspace" }),
      () => mockState({ selectedEdgeIds: ["e1", "e2"], removeEdge }),
    );
    expect(handled).toBe(true);
    expect(removeEdge).toHaveBeenCalledTimes(2);
    expect(removeEdge).toHaveBeenCalledWith("e1");
    expect(removeEdge).toHaveBeenCalledWith("e2");
  });

  it("removes nodes AND edges in the same keystroke when both are selected", () => {
    const removeNode = vi.fn();
    const removeEdge = vi.fn();
    const handled = tryHandleDeleteKey(
      makeEvent({ key: "Backspace" }),
      () =>
        mockState({
          selectedNodeIds: ["n1"],
          selectedEdgeIds: ["e1"],
          removeNode,
          removeEdge,
        }),
    );
    expect(handled).toBe(true);
    expect(removeNode).toHaveBeenCalledWith("n1");
    expect(removeEdge).toHaveBeenCalledWith("e1");
  });

  it("also handles the separate `Delete` key (PC keyboards / Mac forward-delete)", () => {
    const removeNode = vi.fn();
    const handled = tryHandleDeleteKey(makeEvent({ key: "Delete" }), () =>
      mockState({ selectedNodeIds: ["n1"], removeNode }),
    );
    expect(handled).toBe(true);
    expect(removeNode).toHaveBeenCalledWith("n1");
  });

  it.each([["INPUT"], ["TEXTAREA"], ["SELECT"]])(
    "ignores Backspace when target is <%s> (so typing doesn't wipe the canvas)",
    (tagName) => {
      const removeNode = vi.fn();
      const removeEdge = vi.fn();
      const handled = tryHandleDeleteKey(
        makeEvent({ key: "Backspace", target: { tagName } }),
        () =>
          mockState({
            selectedNodeIds: ["n1"],
            selectedEdgeIds: ["e1"],
            removeNode,
            removeEdge,
          }),
      );
      expect(handled).toBe(false);
      expect(removeNode).not.toHaveBeenCalled();
      expect(removeEdge).not.toHaveBeenCalled();
    },
  );

  it("ignores Backspace when target is contentEditable", () => {
    const removeNode = vi.fn();
    const handled = tryHandleDeleteKey(
      makeEvent({
        key: "Backspace",
        target: { tagName: "DIV", isContentEditable: true },
      }),
      () => mockState({ selectedNodeIds: ["n1"], removeNode }),
    );
    expect(handled).toBe(false);
    expect(removeNode).not.toHaveBeenCalled();
  });
});
