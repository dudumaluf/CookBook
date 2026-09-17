import { describe, expect, it } from "vitest";

import {
  blockingTransformOp,
  lookAtAlongForward,
  translateLinked,
} from "@/lib/blocking/camera-gizmo";
import { CAMERA_ID, LOOK_AT_ID } from "@/types/blocking";

describe("camera gizmo helpers", () => {
  it("moves the target alone when unlocked", () => {
    const next = translateLinked([0, 2, 7], [1, 2, 7], [0, 1, 0], false);
    expect(next.moved).toEqual([1, 2, 7]);
    expect(next.other).toEqual([0, 1, 0]);
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
});
