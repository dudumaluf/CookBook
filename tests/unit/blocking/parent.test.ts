import { describe, expect, it } from "vitest";

import { evalCameraAt, evalObjectAt } from "@/lib/blocking/evaluate";
import { applyBlockingOp, applyBlockingOps } from "@/lib/blocking/ops";
import { localToWorld, worldToLocal } from "@/lib/blocking/parent";
import { createDefaultDocument } from "@/types/blocking";

describe("blocking parent", () => {
  it("round-trips a translated parent", () => {
    const trs = {
      position: [2, 1, 0] as const,
      rotation: [0, 0, 0] as const,
      scale: [1, 1, 1] as const,
    };
    const world = localToWorld(trs, [1, 0, 3]);
    expect(world).toEqual([3, 1, 3]);
    expect(worldToLocal(trs, world)).toEqual([1, 0, 3]);
  });

  it("parents the camera without jumping, then follows the object", () => {
    const seeded = applyBlockingOps(createDefaultDocument(), [
      { op: "add_primitive", kind: "capsule", id: "hero", position: [0, 1, 0] },
    ]);
    const before = evalCameraAt(seeded.doc.camera, 0, seeded.doc.objects);
    const parented = applyBlockingOp(seeded.doc, {
      op: "set_parent",
      id: "camera",
      parentId: "hero",
    });
    expect(parented.error).toBeUndefined();
    expect(parented.doc.camera.parentId).toBe("hero");
    const still = evalCameraAt(parented.doc.camera, 0, parented.doc.objects);
    expect(still.position[0]).toBeCloseTo(before.position[0]);
    expect(still.position[1]).toBeCloseTo(before.position[1]);
    expect(still.position[2]).toBeCloseTo(before.position[2]);

    const walked = applyBlockingOp(parented.doc, {
      op: "set_transform",
      id: "hero",
      position: [4, 1, 0],
      tMs: 0,
    });
    const after = evalCameraAt(walked.doc.camera, 0, walked.doc.objects);
    expect(after.position[0]).toBeCloseTo(before.position[0] + 4);
    expect(after.position[2]).toBeCloseTo(before.position[2]);
  });

  it("parents lookAt independently of the camera body", () => {
    const seeded = applyBlockingOps(createDefaultDocument(), [
      { op: "add_primitive", kind: "capsule", id: "hero", position: [0, 1, 0] },
    ]);
    const camBefore = evalCameraAt(seeded.doc.camera, 0, seeded.doc.objects);
    const parented = applyBlockingOp(seeded.doc, {
      op: "set_parent",
      id: "lookAt",
      parentId: "hero",
    });
    const moved = applyBlockingOp(parented.doc, {
      op: "set_transform",
      id: "hero",
      position: [3, 1, 0],
    });
    const after = evalCameraAt(moved.doc.camera, 0, moved.doc.objects);
    expect(after.position).toEqual(camBefore.position);
    expect(after.lookAt[0]).toBeCloseTo(camBefore.lookAt[0] + 3);
    expect(evalObjectAt(moved.doc.objects.find((o) => o.id === "hero")!, 0).position[0]).toBe(3);
  });
});
