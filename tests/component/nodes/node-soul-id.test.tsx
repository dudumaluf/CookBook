import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { soulIdNodeSchema } from "@/components/nodes/node-soul-id";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { SoulIdAsset } from "@/types/asset";

beforeEach(() => {
  useAssetStore.getState().clear();
  localStorage.clear();
});

function seedSoulIdAsset(
  overrides: Partial<SoulIdAsset> = {},
): SoulIdAsset {
  const asset: SoulIdAsset = {
    id: "asset_soul",
    kind: "soul-id",
    name: "Dudu Model",
    tags: [],
    scope: "global",
    createdAt: 1,
    updatedAt: 1,
    customReferenceId: "b66a1caa-612f-440d-8353-debceb00aae6",
    variant: "v2",
    thumbnailUrl: "https://cdn.example/dudu.png",
    ...overrides,
  };
  useAssetStore.setState({ assets: [asset] });
  return asset;
}

describe("soulIdNodeSchema", () => {
  it("has the expected schema shape", () => {
    expect(soulIdNodeSchema.kind).toBe("soul-id");
    expect(soulIdNodeSchema.category).toBe("input");
    expect(soulIdNodeSchema.reactive).toBe(true);
    expect(soulIdNodeSchema.inputs).toHaveLength(0);
    expect(soulIdNodeSchema.outputs[0]?.dataType).toBe("soul-id");
  });

  it("declares horizontal-only resize (single-row body)", () => {
    expect(soulIdNodeSchema.size?.resizable).toBe("horizontal");
    expect(soulIdNodeSchema.size?.minWidth).toBeGreaterThan(0);
    expect(soulIdNodeSchema.size?.maxWidth).toBeGreaterThan(
      soulIdNodeSchema.size!.minWidth!,
    );
  });

  /* ---------------------------------------- empty state ---------------- */

  it("renders the empty-state hint when no character is configured", () => {
    const Body = soulIdNodeSchema.Body;
    render(
      <Body
        nodeId="n1"
        config={{}}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    expect(screen.getByText(/drag a soul id from the library/i)).toBeTruthy();
  });

  /* ---------------------------------------- linked path ---------------- */

  it("renders the linked asset's name + variant chip + thumbnail", () => {
    const asset = seedSoulIdAsset();
    const Body = soulIdNodeSchema.Body;
    render(
      <Body
        nodeId="n1"
        config={{ assetId: asset.id }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    expect(screen.getByText(asset.name)).toBeTruthy();
    expect(screen.getByText(/soul 2/i)).toBeTruthy();
    const thumb = screen.getByAltText(asset.name) as HTMLImageElement;
    expect(thumb.src).toContain("dudu.png");
  });

  it("falls back to a 'Character UUID…' label + User glyph when name + thumbnail are missing", () => {
    const Body = soulIdNodeSchema.Body;
    render(
      <Body
        nodeId="n1"
        config={{
          customReferenceId: "abcd1234-7b2e-4d1a-9e8c-1f4b2a3c5d6e",
          variant: "v2",
        }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    // Truncated UUID prefix as the fallback label.
    expect(screen.getByText(/character abcd1234/i)).toBeTruthy();
    expect(screen.getByText(/soul 2/i)).toBeTruthy();
  });

  it("clicking Unlink snapshots the linked fields back into config and drops assetId", () => {
    const asset = seedSoulIdAsset();
    const updateConfig = vi.fn();
    const Body = soulIdNodeSchema.Body;
    render(
      <Body
        nodeId="n1"
        config={{ assetId: asset.id }}
        updateConfig={updateConfig}
        selected={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /unlink/i }),
    );
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig).toHaveBeenCalledWith({
      assetId: undefined,
      customReferenceId: asset.customReferenceId,
      variant: "v2",
      name: asset.name,
      thumbnailUrl: asset.thumbnailUrl,
    });
  });

  /* ---------------------------------------- variant labels -------------- */

  it("renders 'Cinema' for cinema variant", () => {
    // Use a name with no "cinema" substring so the variant-chip assertion
    // doesn't false-match on the name text.
    const asset = seedSoulIdAsset({ variant: "cinema", name: "Hero" });
    const Body = soulIdNodeSchema.Body;
    render(
      <Body
        nodeId="n1"
        config={{ assetId: asset.id }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    expect(screen.getByText(/cinema/i)).toBeTruthy();
  });

  it("renders 'Soul 1' for v1 variant", () => {
    const asset = seedSoulIdAsset({ variant: "v1", name: "Legacy" });
    const Body = soulIdNodeSchema.Body;
    render(
      <Body
        nodeId="n1"
        config={{ assetId: asset.id }}
        updateConfig={vi.fn()}
        selected={false}
      />,
    );
    expect(screen.getByText(/soul 1/i)).toBeTruthy();
  });

  /* ---------------------------------------- execute() ------------------ */

  describe("execute()", () => {
    it("emits a SoulIdRef from the linked asset (live values win)", async () => {
      const asset = seedSoulIdAsset();
      const result = await soulIdNodeSchema.execute!({
        nodeId: "n1",
        config: { assetId: asset.id, customReferenceId: "stale", variant: "v1" },
        inputs: {},
        signal: new AbortController().signal,
      });
      expect(result).toEqual({
        type: "soul-id",
        value: {
          customReferenceId: asset.customReferenceId,
          variant: "v2",
          name: asset.name,
          thumbnailUrl: asset.thumbnailUrl ?? undefined,
        },
      });
    });

    it("emits a SoulIdRef from the standalone config when no asset is linked", async () => {
      const result = await soulIdNodeSchema.execute!({
        nodeId: "n1",
        config: {
          customReferenceId: "b66a1caa-612f-440d-8353-debceb00aae6",
          variant: "v2",
          name: "Dudu Model",
        },
        inputs: {},
        signal: new AbortController().signal,
      });
      expect(result).toEqual({
        type: "soul-id",
        value: {
          customReferenceId: "b66a1caa-612f-440d-8353-debceb00aae6",
          variant: "v2",
          name: "Dudu Model",
          thumbnailUrl: undefined,
        },
      });
    });

    it("throws a friendly error when the node is empty", async () => {
      await expect(
        soulIdNodeSchema.execute!({
          nodeId: "n1",
          config: {},
          inputs: {},
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/no character/i);
    });

    it("throws when the linked asset has been removed AND no fallback exists", async () => {
      // Asset id points at nothing (asset-store is empty); no denormalised
      // fields on the config either.
      await expect(
        soulIdNodeSchema.execute!({
          nodeId: "n1",
          config: { assetId: "asset_gone" },
          inputs: {},
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/no character/i);
    });
  });
});
