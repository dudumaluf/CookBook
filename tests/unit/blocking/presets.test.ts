import { describe, expect, it } from "vitest";

import { applyBlockingOps } from "@/lib/blocking/ops";
import { evalCameraAt } from "@/lib/blocking/evaluate";
import { createDefaultDocument } from "@/types/blocking";

describe("blocking presets", () => {
  it("apply_preset writes a camera pose looking at the subject", () => {
    const { doc } = applyBlockingOps(createDefaultDocument(), [
      { op: "add_primitive", kind: "capsule", id: "hero", position: [0, 1, 0] },
      { op: "apply_preset", preset: "close", subjectId: "hero", tMs: 0 },
    ]);
    const cam = evalCameraAt(doc.camera, 0, doc.objects);
    expect(cam.lookAt[1]).toBeGreaterThan(1);
    expect(Math.hypot(cam.position[0], cam.position[2])).toBeGreaterThan(0.5);
    expect(doc.camera.poseKeys[0]?.position).toBeTruthy();
  });
});
