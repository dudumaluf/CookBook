import { describe, expect, it } from "vitest";

import { deleteBlockingSelection } from "@/components/nodes/blocking/editor-actions";
import { CAMERA_ID, LOOK_AT_ID } from "@/types/blocking";

describe("deleteBlockingSelection", () => {
  it("removes a selected key after 0ms", () => {
    expect(
      deleteBlockingSelection({
        selectedId: "hero",
        selectedKey: { id: "hero", channel: "position", tMs: 1200 },
      }),
    ).toEqual({
      op: "remove_keyframe",
      id: "hero",
      channel: "position",
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

  it("never deletes camera, lookAt, or ground", () => {
    expect(
      deleteBlockingSelection({ selectedId: CAMERA_ID, selectedKey: null }),
    ).toBeNull();
    expect(
      deleteBlockingSelection({ selectedId: LOOK_AT_ID, selectedKey: null }),
    ).toBeNull();
    expect(
      deleteBlockingSelection({ selectedId: "ground", selectedKey: null }),
    ).toBeNull();
  });
});
