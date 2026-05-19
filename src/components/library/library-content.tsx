"use client";

import { type ReactNode } from "react";

import { useAssetStore } from "@/lib/stores/asset-store";
import type { ImageAsset } from "@/types/asset";

import { AssetCard } from "./asset-card";

/**
 * LibraryContent
 *
 * Renders the body of the LibraryPanel. Pulled out of LibraryPanel so the
 * panel chrome (header, collapse, scroll) stays simple and the content can be
 * reused (e.g. as a Library tab in a future asset picker).
 *
 * Slice 2: groups by kind. Only `image` exists today; future kinds add their
 * own Section here.
 */
export function LibraryContent() {
  const assets = useAssetStore((s) => s.assets);

  const imageAssets = assets.filter(
    (a): a is ImageAsset => a.kind === "image",
  );

  if (imageAssets.length === 0) {
    return (
      <div className="flex flex-col items-start gap-1.5 px-3 py-4">
        <p className="text-sm text-foreground/80">No assets yet</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Click <span className="font-medium text-foreground/80">+</span> to
          import an image. Drag it onto the canvas to spawn an Image node
          already linked to the asset.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <Section title="Images" count={imageAssets.length}>
        <div className="grid grid-cols-2 gap-1.5">
          {imageAssets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <header className="flex items-center justify-between px-0.5">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <span className="text-[10.5px] tabular-nums text-muted-foreground/70">
          {count}
        </span>
      </header>
      {children}
    </section>
  );
}
