import { describe, expect, it } from "vitest";

import { applyBlockingOp, applyBlockingOps } from "@/lib/blocking/ops";
import { cameraAtDoc, shotAt } from "@/lib/blocking/shots";
import { createDefaultDocument } from "@/types/blocking";

describe("blocking shots", () => {
  it("add_shot splits the partition with no holes", () => {
    const { doc } = applyBlockingOps(createDefaultDocument(), [
      { op: "add_camera", id: "cam_b" },
      { op: "add_shot", tMs: 2000, cameraId: "cam_b" },
    ]);
    expect(doc.shots).toHaveLength(2);
    expect(doc.shots[0]?.outMs).toBe(2000);
    expect(doc.shots[1]?.inMs).toBe(2000);
    expect(doc.shots[1]?.outMs).toBe(doc.durationMs);
    expect(shotAt(doc, 500)?.cameraId).toBe("camera");
    expect(cameraAtDoc(doc, 3000).id).toBe("cam_b");
  });

  it("move_shot_cut slides the shared boundary", () => {
    const seeded = applyBlockingOps(createDefaultDocument(), [
      { op: "add_camera", id: "cam_b" },
      { op: "add_shot", tMs: 2000, cameraId: "cam_b" },
    ]);
    const moved = applyBlockingOp(seeded.doc, {
      op: "move_shot_cut",
      afterIndex: 0,
      toMs: 3500,
    });
    expect(moved.doc.shots[0]?.outMs).toBe(3500);
    expect(moved.doc.shots[1]?.inMs).toBe(3500);
  });
});
