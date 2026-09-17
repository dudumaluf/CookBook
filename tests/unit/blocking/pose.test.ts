import { describe, expect, it } from "vitest";

import { applyBlockingOp, applyBlockingOps } from "@/lib/blocking/ops";
import { editTargetMs, findPose } from "@/lib/blocking/pose";
import { evalObjectAt } from "@/lib/blocking/evaluate";
import {
  createDefaultDocument,
  sanitizeBlockingDocument,
} from "@/types/blocking";

describe("blocking pose keys", () => {
  it("migrates stacked tracks into one pose tick per time", () => {
    const doc = sanitizeBlockingDocument({
      objects: [
        {
          id: "box",
          kind: "box",
          tracks: {
            position: [
              { tMs: 0, value: [0, 0, 0] },
              { tMs: 1000, value: [2, 0, 0] },
            ],
            rotation: [{ tMs: 0, value: [0, 0, 0] }, { tMs: 1000, value: [0, 90, 0] }],
            scale: [{ tMs: 0, value: [1, 1, 1] }],
          },
        },
      ],
    });
    const box = doc.objects.find((o) => o.id === "box")!;
    expect(box.poseKeys.map((p) => p.tMs)).toEqual([0, 1000]);
    expect(box.poseKeys[1]?.position?.[0]).toBe(2);
    expect(box.poseKeys[1]?.rotation?.[1]).toBe(90);
    expect(box.poseKeys[1]?.scale).toBeUndefined();
  });

  it("upsert_pose keys one channel without snapshotting the others", () => {
    const seeded = applyBlockingOp(createDefaultDocument(), {
      op: "add_primitive",
      kind: "box",
      id: "box",
      position: [0, 0.5, 0],
    });
    const keyed = applyBlockingOp(seeded.doc, {
      op: "upsert_pose",
      id: "box",
      tMs: 1000,
      position: [2, 0.5, 0],
    });
    const box = keyed.doc.objects.find((o) => o.id === "box")!;
    const pose = findPose(box.poseKeys, 1000);
    expect(pose?.position?.[0]).toBe(2);
    expect(pose?.rotation).toBeUndefined();
    expect(evalObjectAt(box, 1000, keyed.doc.objects).rotation).toEqual([0, 0, 0]);
  });

  it("remove_pose_channel drops that field and the tick if empty", () => {
    const { doc } = applyBlockingOps(createDefaultDocument(), [
      { op: "add_primitive", kind: "box", id: "box" },
      { op: "upsert_pose", id: "box", tMs: 500, position: [1, 0, 0] },
    ]);
    const gone = applyBlockingOp(doc, {
      op: "remove_pose_channel",
      id: "box",
      tMs: 500,
      channel: "position",
    });
    const box = gone.doc.objects.find((o) => o.id === "box")!;
    expect(findPose(box.poseKeys, 500)).toBeUndefined();
  });

  it("editTargetMs never writes between keys unless auto-key or a selected key", () => {
    expect(
      editTargetMs({
        autoKey: false,
        playheadMs: 800,
        selectedKeyT: null,
        hasPoseAtPlayhead: false,
      }),
    ).toBeNull();
    expect(
      editTargetMs({
        autoKey: false,
        playheadMs: 800,
        selectedKeyT: 400,
        hasPoseAtPlayhead: false,
      }),
    ).toBe(400);
    expect(
      editTargetMs({
        autoKey: true,
        playheadMs: 800,
        selectedKeyT: null,
        hasPoseAtPlayhead: false,
      }),
    ).toBe(800);
  });

  it("legacy docs get cameras[] + one shot", () => {
    const doc = sanitizeBlockingDocument({ camera: { fov: 50 } });
    expect(doc.cameras[0]?.id).toBe("camera");
    expect(doc.shots).toHaveLength(1);
    expect(doc.shots[0]?.outMs).toBe(doc.durationMs);
    expect(doc.camera.poseKeys[0]?.fov).toBe(50);
  });
});
