import { describe, expect, it } from "vitest";

import {
  ASSET_DRAG_MIME,
  parseAssetDrag,
  serializeAssetDrag,
} from "@/lib/library/asset-drag";

describe("asset-drag", () => {
  it("uses a Cookbook-specific MIME so foreign drags don't collide", () => {
    expect(ASSET_DRAG_MIME).toMatch(/^application\/x-cookbook-asset$/);
  });

  /* ────────────────────────── New (multi) shape ────────────────────────── */

  describe("multi-id payload (Slice 5.5c)", () => {
    it("round-trips a 1-id payload (single-asset drag)", () => {
      const payload = { assetIds: ["asset_abc123"], kind: "image" as const };
      const wire = serializeAssetDrag(payload);
      expect(parseAssetDrag(wire)).toEqual(payload);
    });

    it("round-trips an N-id payload (multi-select drag)", () => {
      const payload = {
        assetIds: ["asset_a", "asset_b", "asset_c"],
        kind: "image" as const,
      };
      const wire = serializeAssetDrag(payload);
      expect(parseAssetDrag(wire)).toEqual(payload);
    });

    it("filters out non-string ids (defensive against malformed payloads)", () => {
      const wire = JSON.stringify({
        assetIds: ["a", 123, null, "b"],
        kind: "image",
      });
      expect(parseAssetDrag(wire)).toEqual({
        assetIds: ["a", "b"],
        kind: "image",
      });
    });

    it("returns null when assetIds is empty after filtering", () => {
      const wire = JSON.stringify({
        assetIds: [123, null, false],
        kind: "image",
      });
      expect(parseAssetDrag(wire)).toBeNull();
    });
  });

  /* ──────────────────── Legacy single-id back-compat ──────────────────── */

  describe("legacy single-id payload (pre-5.5c)", () => {
    it("promotes a legacy { assetId } payload to a 1-element { assetIds[] }", () => {
      // Belt-and-suspenders: an in-flight drag started before the page
      // refresh, or a hand-crafted DataTransfer payload, can still land
      // on the new parser. We accept it transparently.
      const wire = JSON.stringify({ assetId: "asset_abc", kind: "image" });
      expect(parseAssetDrag(wire)).toEqual({
        assetIds: ["asset_abc"],
        kind: "image",
      });
    });
  });

  /* ────────────────────────── Defensive parsing ────────────────────────── */

  describe("malformed input", () => {
    it("returns null on empty string", () => {
      expect(parseAssetDrag("")).toBeNull();
    });
    it("returns null on non-JSON garbage", () => {
      expect(parseAssetDrag("{not json")).toBeNull();
    });
    it("returns null on missing kind", () => {
      expect(parseAssetDrag(JSON.stringify({ assetIds: ["x"] }))).toBeNull();
    });
    it("returns null on missing both assetId and assetIds", () => {
      expect(
        parseAssetDrag(JSON.stringify({ kind: "image" })),
      ).toBeNull();
    });
    it("returns null when assetId is a non-string", () => {
      expect(
        parseAssetDrag(JSON.stringify({ assetId: 123, kind: "image" })),
      ).toBeNull();
    });
  });
});
