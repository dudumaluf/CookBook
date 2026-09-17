import { describe, expect, it } from "vitest";

import { evalInstanceAt, instanceCount, layoutTransform } from "@/lib/blocking/instance";
import { applyBlockingOp, applyBlockingOps } from "@/lib/blocking/ops";
import { createDefaultDocument } from "@/types/blocking";

describe("blocking instancer", () => {
  it("lays out linear clones along the spacing vector", () => {
    const layout = layoutTransform(
      {
        mode: "linear",
        count: 4,
        columns: 3,
        rows: 3,
        spacing: [2, 0, 0],
        seed: 1,
      },
      3,
    );
    expect(layout.position).toEqual([6, 0, 0]);
  });

  it("grid count is columns × rows on the floor", () => {
    const settings = {
      mode: "grid" as const,
      count: 99,
      columns: 3,
      rows: 2,
      spacing: [2, 0, 3] as [number, number, number],
      seed: 1,
    };
    expect(instanceCount(settings)).toBe(6);
    expect(layoutTransform(settings, 4).position).toEqual([2, 0, 3]);
  });

  it("instances a parented source and a random effector offsets later clones", () => {
    const seeded = applyBlockingOps(createDefaultDocument(), [
      { op: "add_primitive", kind: "instancer", id: "crowd" },
      { op: "add_primitive", kind: "capsule", id: "hero", position: [0, 1, 0] },
      { op: "set_parent", id: "hero", parentId: "crowd" },
      { op: "set_instancer", id: "crowd", patch: { mode: "linear", count: 3, spacing: [2, 0, 0] } },
      { op: "add_primitive", kind: "effector", id: "jitter" },
      { op: "set_parent", id: "jitter", parentId: "crowd" },
      {
        op: "set_effector",
        id: "jitter",
        patch: { type: "random", position: true, rotation: false, scale: false, amount: [0.5, 0, 0] },
      },
    ]);
    expect(seeded.errors).toEqual([]);
    const inst = seeded.doc.objects.find((o) => o.id === "crowd")!;
    expect(inst.kind).toBe("instancer");
    const a = evalInstanceAt(
      seeded.doc,
      { nodeId: "hero::0", sourceId: "hero", instancerId: "crowd", index: 0 },
      0,
    );
    const b = evalInstanceAt(
      seeded.doc,
      { nodeId: "hero::1", sourceId: "hero", instancerId: "crowd", index: 1 },
      0,
    );
    expect(a.position[1]).toBeCloseTo(1);
    expect(b.position[0]).not.toBeCloseTo(a.position[0] + 2, 5);
  });

  it("tints an object via set_color", () => {
    const added = applyBlockingOp(createDefaultDocument(), {
      op: "add_primitive",
      kind: "box",
      id: "crate",
    });
    const tinted = applyBlockingOp(added.doc, {
      op: "set_color",
      id: "crate",
      color: "#ff8800",
    });
    expect(tinted.doc.objects[0]?.color).toBe("#ff8800");
    const cleared = applyBlockingOp(tinted.doc, {
      op: "set_color",
      id: "crate",
      color: null,
    });
    expect(cleared.doc.objects[0]?.color).toBeUndefined();
  });
});
