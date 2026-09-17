import { describe, expect, it } from "vitest";

import { applyBlockingOp } from "@/lib/blocking/ops";
import { sampleVatClip, syntheticVatPack, vatVertexAt } from "@/lib/blocking/vat";
import { createDefaultDocument } from "@/types/blocking";

describe("blocking VAT consume", () => {
  it("synthetic pack has idle then walk rows", () => {
    const pack = syntheticVatPack();
    expect(pack.format).toBe("vat-bake/2");
    expect(pack.clips.map((c) => c.name)).toEqual(["idle", "walk"]);
    expect(pack.positions.length).toBe(pack.vertexCount * 8 * 3);
    const a = vatVertexAt(pack, 0, 0);
    expect(a[1]).toBeGreaterThanOrEqual(0);
  });

  it("add_vat + set_vat_clip keys the state strip", () => {
    const added = applyBlockingOp(createDefaultDocument(), {
      op: "add_vat",
      id: "char",
    });
    const vat = added.doc.objects.find((o) => o.id === "char")!;
    expect(vat.kind).toBe("vat");
    expect(vat.vat?.clips[0]?.name).toBe("idle");
    const keyed = applyBlockingOp(added.doc, {
      op: "set_vat_clip",
      id: "char",
      clip: "walk",
      tMs: 1000,
    });
    const next = keyed.doc.objects.find((o) => o.id === "char")!.vat!;
    expect(next.clipKeys.some((k) => k.tMs === 1000 && k.clip === "walk")).toBe(true);
    expect(sampleVatClip(next, 1200).clip.name).toBe("walk");
  });
});
