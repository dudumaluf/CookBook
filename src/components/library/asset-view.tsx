"use client";

import type { LibraryThumb, LibraryView } from "@/lib/stores/layout-store";
import type { Asset } from "@/types/asset";

import { AssetCard } from "./asset-card";
import { AssetRow } from "./asset-row";

/**
 * Asset view wrappers (Library revamp). Render a set of assets as either a
 * responsive grid (thumbnail size driven by `LibraryThumb`) or a dense
 * list. Shared by the Library panel and the Library drawer so both surfaces
 * look identical.
 */

/** Min thumbnail width per size — drives `auto-fill` so the grid adapts to
 *  the container (narrow panel = fewer columns, wide drawer = many). */
const THUMB_MIN_PX: Record<LibraryThumb, number> = { s: 64, m: 92, l: 132 };

export function AssetGrid({
  assets,
  size,
  onOpen,
}: {
  assets: Asset[];
  size: LibraryThumb;
  onOpen?: (asset: Asset) => void;
}) {
  return (
    <div
      data-testid="asset-grid"
      className="grid gap-1.5"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_MIN_PX[size]}px, 1fr))`,
      }}
    >
      {assets.map((asset) => (
        <AssetCard key={asset.id} asset={asset} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function AssetList({
  assets,
  onOpen,
}: {
  assets: Asset[];
  onOpen?: (asset: Asset) => void;
}) {
  return (
    <div data-testid="asset-list" className="flex flex-col gap-1">
      {assets.map((asset) => (
        <AssetRow key={asset.id} asset={asset} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function AssetView({
  assets,
  view,
  size,
  onOpen,
}: {
  assets: Asset[];
  view: LibraryView;
  size: LibraryThumb;
  onOpen?: (asset: Asset) => void;
}) {
  return view === "list" ? (
    <AssetList assets={assets} onOpen={onOpen} />
  ) : (
    <AssetGrid assets={assets} size={size} onOpen={onOpen} />
  );
}
