import type { Asset, AssetKind } from "@/types/asset";

/**
 * Library filtering (Library revamp). A pure helper shared by the Library
 * panel and the Library drawer so search + type-filter behave identically
 * in both surfaces.
 *
 * - `kind: "all"` (default) matches every kind.
 * - `query` is a case-insensitive substring matched against an asset's
 *   `name` and any of its `tags`.
 */
export type AssetFilterKind = "all" | AssetKind;

export interface AssetFilterOptions {
  query?: string;
  kind?: AssetFilterKind;
}

export function filterAssets(
  assets: readonly Asset[],
  opts: AssetFilterOptions = {},
): Asset[] {
  const query = opts.query?.trim().toLowerCase() ?? "";
  const kind = opts.kind ?? "all";
  return assets.filter((asset) => {
    if (kind !== "all" && asset.kind !== kind) return false;
    if (query.length > 0) {
      const inName = asset.name.toLowerCase().includes(query);
      const inTags = asset.tags.some((t) => t.toLowerCase().includes(query));
      if (!inName && !inTags) return false;
    }
    return true;
  });
}

/** Count assets per kind (for filter-chip badges). Includes a `total`. */
export function countAssetsByKind(
  assets: readonly Asset[],
): Record<AssetKind, number> & { total: number } {
  const counts = {
    image: 0,
    "soul-id": 0,
    "asset-group": 0,
    video: 0,
    audio: 0,
    total: assets.length,
  } as Record<AssetKind, number> & { total: number };
  for (const asset of assets) counts[asset.kind] += 1;
  return counts;
}
