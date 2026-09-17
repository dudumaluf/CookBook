import { describe, expect, it } from "vitest";

import { applyBlockingOp, applyBlockingOps } from "@/lib/blocking/ops";
import { evalObjectAt } from "@/lib/blocking/evaluate";
import { readScene, sampleAt } from "@/lib/blocking/query";
import {
  CAMERA_ID,
  createDefaultDocument,
  sanitizeBlockingDocument,
} from "@/types/blocking";

describe("blocking ops", () => {
  it("sanitizes junk into a default stage with a ground plane", () => {
    const doc = sanitizeBlockingDocument(undefined);
    expect(doc.version).toBe(1);
    expect(doc.objects.some((o) => o.kind === "plane")).toBe(true);
    expect(doc.camera.fov).toBeGreaterThan(0);
    expect(doc.durationMs).toBe(5000);
  });

  it("adds a capsule and can remove it; camera is protected", () => {
    const base = createDefaultDocument();
    const added = applyBlockingOp(base, {
      op: "add_primitive",
      kind: "capsule",
      name: "Hero",
      id: "hero",
    });
    expect(added.error).toBeUndefined();
    expect(added.doc.objects.some((o) => o.id === "hero")).toBe(true);
    expect(evalObjectAt(added.doc.objects.find((o) => o.id === "hero")!, 0).position[1]).toBe(1);

    const gone = applyBlockingOp(added.doc, { op: "remove_object", id: "hero" });
    expect(gone.doc.objects.some((o) => o.id === "hero")).toBe(false);

    const cam = applyBlockingOp(added.doc, { op: "remove_object", id: CAMERA_ID });
    expect(cam.error).toMatch(/camera/i);
  });

  it("keyframes interpolate and sample_at matches evaluate", () => {
    const base = createDefaultDocument();
    const { doc } = applyBlockingOps(base, [
      { op: "add_primitive", kind: "box", id: "box", position: [-2, 0.5, 0] },
      {
        op: "set_keyframe",
        id: "box",
        channel: "position",
        tMs: 1000,
        value: [2, 0.5, 0],
        easing: "linear",
      },
    ]);
    const mid = evalObjectAt(doc.objects.find((o) => o.id === "box")!, 500);
    expect(mid.position[0]).toBeCloseTo(0);
    expect(mid.position[1]).toBeCloseTo(0.5);
    const sampled = sampleAt(doc, 500, "box") as { position: [number, number, number] };
    expect(sampled.position[0]).toBeCloseTo(0);
  });

  it("set_camera writes lookAt and fov", () => {
    const { doc } = applyBlockingOp(createDefaultDocument(), {
      op: "set_camera",
      lookAt: [1, 1, 0],
      fov: 55,
      tMs: 0,
    });
    expect(doc.camera.fov).toBe(55);
    expect(doc.camera.lookAt[0]?.value).toEqual([1, 1, 0]);
  });

  it("import_mesh + play_clip", () => {
    const { doc, createdId } = applyBlockingOp(createDefaultDocument(), {
      op: "import_mesh",
      url: "https://cdn/x.glb",
      name: "Walk",
    });
    expect(createdId).toBeTruthy();
    const mesh = doc.objects.find((o) => o.id === createdId);
    expect(mesh?.kind).toBe("mesh");
    const clipped = applyBlockingOp(doc, {
      op: "play_clip",
      id: createdId!,
      name: "WalkCycle",
      speed: 1,
    });
    expect(clipped.doc.objects.find((o) => o.id === createdId)?.clip?.name).toBe(
      "WalkCycle",
    );
  });

  it("rejects lookAt on a primitive", () => {
    const { doc } = applyBlockingOp(createDefaultDocument(), {
      op: "add_primitive",
      kind: "box",
      id: "box",
    });
    const bad = applyBlockingOp(doc, {
      op: "set_keyframe",
      id: "box",
      channel: "lookAt",
      tMs: 100,
      value: [0, 0, 0],
    });
    expect(bad.error).toMatch(/lookAt/);
  });

  it("read_scene is compact", () => {
    const scene = readScene(createDefaultDocument(), 0);
    expect(scene.objects).toBeInstanceOf(Array);
    expect(JSON.stringify(scene)).not.toMatch(/easing/);
  });
});
