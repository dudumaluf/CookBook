import { describe, expect, it } from "vitest";

import {
  blockingTransformOp,
  extraTransformOps,
  groupTranslateCamera,
  lookAtAlongForward,
  translateLinked,
} from "@/lib/blocking/camera-gizmo";
import { applyBlockingOp } from "@/lib/blocking/ops";
import { CAMERA_ID, LOOK_AT_ID, createDefaultDocument } from "@/types/blocking";

describe("camera gizmo helpers", () => {
  it("moves the target alone when unlocked", () => {
    const next = translateLinked([0, 2, 7], [1, 2, 7], [0, 1, 0], false);
    expect(next.moved).toEqual([1, 2, 7]);
    expect(next.other).toEqual([0, 1, 0]);
  });

  it("group-translates camera and lookAt from either handle", () => {
    const cam = { position: [0, 2, 7] as const, lookAt: [0, 1, 0] as const };
    const fromCam = groupTranslateCamera(cam, "position", [2, 2, 7], true);
    expect(fromCam.position).toEqual([2, 2, 7]);
    expect(fromCam.lookAt).toEqual([2, 1, 0]);
    const fromLook = groupTranslateCamera(cam, "lookAt", [1, 1, 0], true);
    expect(fromLook.position).toEqual([1, 2, 7]);
    expect(fromLook.lookAt).toEqual([1, 1, 0]);
    const solo = groupTranslateCamera(cam, "position", [2, 2, 7], false);
    expect(solo.lookAt).toEqual([0, 1, 0]);
  });

  it("keeps camera and lookAt locked when linked", () => {
    const next = translateLinked([0, 2, 7], [2, 3, 6], [0, 1, 0], true);
    expect(next.moved).toEqual([2, 3, 6]);
    expect(next.other).toEqual([2, 2, -1]);
  });

  it("aims lookAt along camera forward at the previous distance", () => {
    const look = lookAtAlongForward([0, 0, 0], [0, 0, -1], 4);
    expect(look[0]).toBeCloseTo(0);
    expect(look[1]).toBeCloseTo(0);
    expect(look[2]).toBeCloseTo(-4);
  });

  it("writes camera ops for both camera and lookAt pick ids", () => {
    const cam = blockingTransformOp(CAMERA_ID, { position: [1, 2, 3] }, 120);
    expect(cam).toEqual({
      op: "set_transform",
      id: CAMERA_ID,
      position: [1, 2, 3],
      tMs: 120,
    });
    const look = blockingTransformOp(
      LOOK_AT_ID,
      { lookAt: [0, 1, 0], position: [4, 2, 7] },
      0,
    );
    expect(look).toMatchObject({
      op: "set_transform",
      id: CAMERA_ID,
      position: [4, 2, 7],
      lookAt: [0, 1, 0],
      tMs: 0,
    });
  });

  it("applies the same move delta to the other selected objects", () => {
    let doc = createDefaultDocument();
    doc = applyBlockingOp(doc, {
      op: "add_primitive",
      kind: "box",
      id: "a",
      position: [0, 0.5, 0],
    }).doc;
    doc = applyBlockingOp(doc, {
      op: "add_primitive",
      kind: "box",
      id: "b",
      position: [2, 0.5, 0],
    }).doc;
    const extras = extraTransformOps(
      doc,
      "a",
      { position: [1, 0.5, 0] },
      ["a", "b"],
      0,
    );
    expect(extras).toHaveLength(1);
    expect(extras[0]).toMatchObject({
      op: "set_transform",
      id: "b",
      position: [3, 0.5, 0],
    });
  });

  it("does not double-move a selected child when the parent is the gizmo", () => {
    let doc = createDefaultDocument();
    doc = applyBlockingOp(doc, {
      op: "add_primitive",
      kind: "capsule",
      id: "hero",
      position: [0, 1, 0],
    }).doc;
    doc = applyBlockingOp(doc, {
      op: "add_primitive",
      kind: "sphere",
      id: "eye",
      position: [0.25, 1.6, 0],
    }).doc;
    doc = applyBlockingOp(doc, {
      op: "set_parent",
      id: "eye",
      parentId: "hero",
    }).doc;
    const extras = extraTransformOps(
      doc,
      "hero",
      { position: [2, 1, 0] },
      ["hero", "eye"],
      0,
    );
    expect(extras).toEqual([]);
  });
});
