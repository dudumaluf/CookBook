"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { importImageFiles } from "@/lib/library/import-files";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { ImageAsset, SoulIdAsset } from "@/types/asset";

import { AssetCard } from "./asset-card";

/**
 * LibraryContent
 *
 * Renders the body of the LibraryPanel. Pulled out of LibraryPanel so the
 * panel chrome (header, collapse, scroll) stays simple and the content can be
 * reused (e.g. as a Library tab in a future asset picker).
 *
 * Doubles as a drop zone: dropping OS files anywhere on the panel body
 * imports them (same pipeline as the Choose-files button). The drag-over
 * highlight stays subtle so it doesn't fight the visible asset cards.
 */
export function LibraryContent() {
  const assets = useAssetStore((s) => s.assets);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const imageAssets = assets.filter(
    (a): a is ImageAsset => a.kind === "image",
  );
  const soulIdAssets = assets.filter(
    (a): a is SoulIdAsset => a.kind === "soul-id",
  );

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setIsDropTarget(false);
    if (event.dataTransfer.files.length === 0) return;
    const result = await importImageFiles(
      Array.from(event.dataTransfer.files),
    );
    if (result.created > 0) {
      toast.success(
        `${result.created} image${result.created === 1 ? "" : "s"} added to Library`,
      );
    }
    for (const err of result.errors) toast.error(err);
  }

  return (
    <div
      onDragOver={(e) => {
        // Only react to OS file drags — never to the in-app asset drag MIME
        // (which targets the canvas, not the library).
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setIsDropTarget(true);
        }
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the container itself, not its children.
        if (e.currentTarget === e.target) setIsDropTarget(false);
      }}
      onDrop={(event) => {
        void handleDrop(event);
      }}
      className={`relative flex flex-col gap-3 px-3 py-3 transition-colors ${
        isDropTarget ? "bg-accent/5" : ""
      }`}
    >
      {imageAssets.length === 0 && soulIdAssets.length === 0 ? (
        <div className="flex flex-col items-start gap-1.5">
          <p className="text-sm text-foreground/80">No assets yet</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Click <span className="font-medium text-foreground/80">+</span> to
            upload from disk, or drop images right here. Drag a card onto the
            canvas to spawn an Image node already linked.
          </p>
        </div>
      ) : (
        <>
          {soulIdAssets.length > 0 ? (
            <Section title="Soul IDs" count={soulIdAssets.length}>
              <div className="grid grid-cols-2 gap-1.5">
                {soulIdAssets.map((asset) => (
                  <AssetCard key={asset.id} asset={asset} />
                ))}
              </div>
            </Section>
          ) : null}
          {imageAssets.length > 0 ? (
            <Section title="Images" count={imageAssets.length}>
              <div className="grid grid-cols-2 gap-1.5">
                {imageAssets.map((asset) => (
                  <AssetCard key={asset.id} asset={asset} />
                ))}
              </div>
            </Section>
          ) : null}
        </>
      )}
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
