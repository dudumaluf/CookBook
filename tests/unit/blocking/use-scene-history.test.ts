import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSceneHistory } from "@/components/nodes/blocking/use-scene-history";
import { applyBlockingOp } from "@/lib/blocking/ops";
import { createDefaultDocument } from "@/types/blocking";

describe("useSceneHistory", () => {
  it("undoes and redoes a scene edit, including after a later snapshot", () => {
    const start = createDefaultDocument();
    const { result } = renderHook(() => useSceneHistory(start));

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);

    const added = applyBlockingOp(start, {
      op: "add_primitive",
      kind: "capsule",
      id: "hero",
    }).doc;
    act(() => {
      result.current.push(added);
    });
    expect(result.current.canUndo).toBe(true);

    let undone: ReturnType<typeof result.current.undo> = null;
    act(() => {
      undone = result.current.undo();
    });
    expect(undone?.objects.some((o) => o.id === "hero")).toBe(false);
    expect(result.current.canRedo).toBe(true);

    let redone: ReturnType<typeof result.current.redo> = null;
    act(() => {
      redone = result.current.redo();
    });
    expect(redone?.objects.some((o) => o.id === "hero")).toBe(true);

    const gone = applyBlockingOp(added, { op: "remove_object", id: "hero" }).doc;
    act(() => {
      result.current.push(gone);
    });
    act(() => {
      undone = result.current.undo();
    });
    expect(undone?.objects.some((o) => o.id === "hero")).toBe(true);
  });
});
