import { describe, expect, it } from "vitest";

import {
  deleteBlockingOps,
  deleteBlockingSelection,
  nextSelection,
} from "@/components/nodes/blocking/editor-actions";
import { CAMERA_ID, LOOK_AT_ID } from "@/types/blocking";

describe("deleteBlockingSelection", () => {
  it("removes a selected key after 0ms", () => {
    expect(
      deleteBlockingSelection({
        selectedId: "hero",
        selectedKey: { id: "hero", channel: "position", tMs: 1200 },
      }),
    ).toEqual({
      op: "remove_pose",
      id: "hero",
      tMs: 1200,
    });
  });

  it("does not remove the 0ms rest pose", () => {
    expect(
      deleteBlockingSelection({
        selectedId: "hero",
        selectedKey: { id: "hero", channel: "position", tMs: 0 },
      }),
    ).toBeNull();
  });

  it("removes a scene object", () => {
    expect(
      deleteBlockingSelection({ selectedId: "hero", selectedKey: null }),
    ).toEqual({ op: "remove_object", id: "hero" });
  });

  it("never deletes camera or lookAt; ground is a normal object", () => {
    expect(
      deleteBlockingSelection({ selectedId: CAMERA_ID, selectedKey: null }),
    ).toBeNull();
    expect(
      deleteBlockingSelection({ selectedId: LOOK_AT_ID, selectedKey: null }),
    ).toBeNull();
    expect(
      deleteBlockingSelection({ selectedId: "ground", selectedKey: null }),
    ).toEqual({ op: "remove_object", id: "ground" });
  });

  it("deletes every unlocked id in a multi-selection", () => {
    expect(
      deleteBlockingOps({
        selectedIds: [CAMERA_ID, "hero", "ground", "box"],
        selectedKey: null,
      }),
    ).toEqual([
      { op: "remove_object", id: "hero" },
      { op: "remove_object", id: "ground" },
      { op: "remove_object", id: "box" },
    ]);
  });
});

describe("nextSelection", () => {
  const order = [CAMERA_ID, LOOK_AT_ID, "a", "b", "c"];

  it("replaces, toggles, and ranges", () => {
    expect(nextSelection(["a"], "c", "replace", order)).toEqual(["c"]);
    expect(nextSelection(["a"], "c", "toggle", order)).toEqual(["a", "c"]);
    expect(nextSelection(["a", "c"], "c", "toggle", order)).toEqual(["a"]);
    expect(nextSelection(["a"], "c", "range", order)).toEqual(["a", "b", "c"]);
  });
});
