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

  it("round-trips a payload through serialize → parse", () => {
    const payload = { assetId: "asset_abc123", kind: "image" as const };
    const wire = serializeAssetDrag(payload);
    expect(parseAssetDrag(wire)).toEqual(payload);
  });

  it("parseAssetDrag returns null on garbage input", () => {
    expect(parseAssetDrag("")).toBeNull();
    expect(parseAssetDrag("{not json")).toBeNull();
    expect(parseAssetDrag(JSON.stringify({ assetId: 123 }))).toBeNull();
    expect(parseAssetDrag(JSON.stringify({ assetId: "x" }))).toBeNull();
  });
});
