import { describe, expect, it } from "vitest";

import { applyBlockingOp } from "@/lib/blocking/ops";
import { createDefaultDocument } from "@/types/blocking";

describe("blocking figure + locomotion", () => {
  it("add_figure parents limbs under a named root", () => {
    const { doc, createdId } = applyBlockingOp(createDefaultDocument(), {
      op: "add_figure",
      id: "hero",
      name: "Hero",
    });
    expect(createdId).toBe("hero");
    expect(doc.objects.find((o) => o.id === "hero")?.kind).toBe("capsule");
    expect(doc.objects.find((o) => o.id === "hero_head")?.parentId).toBe("hero_torso");
    expect(doc.objects.find((o) => o.id === "hero_leg_l")?.parentId).toBe("hero");
  });

  it("apply_locomotion keys the root A→B", () => {
    const fig = applyBlockingOp(createDefaultDocument(), {
      op: "add_figure",
      id: "hero",
    });
    const walked = applyBlockingOp(fig.doc, {
      op: "apply_locomotion",
      id: "hero",
      from: [0, 1, 0],
      to: [4, 1, 0],
      startMs: 0,
      endMs: 2000,
    });
    const root = walked.doc.objects.find((o) => o.id === "hero")!;
    expect(root.poseKeys.some((p) => p.tMs === 2000 && p.position?.[0] === 4)).toBe(true);
  });
});
