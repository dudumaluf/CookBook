"use client";

import { Image as ImageIcon, Trash2, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ASSET_DRAG_MIME,
  serializeAssetDrag,
} from "@/lib/library/asset-drag";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { Asset, ImageAsset, SoulIdAsset } from "@/types/asset";

interface AssetCardProps {
  asset: Asset;
}

/**
 * AssetCard
 *
 * One draggable card per asset. Uses native HTML5 drag with a custom MIME so
 * the canvas drop handler can confidently ignore foreign drags (OS files,
 * other apps' URLs).
 *
 * Visual: square thumbnail + truncated name; hovering reveals a Delete chip.
 * Grid density and multi-select land in a later pass — design accommodates
 * by keeping the card self-contained.
 */
export function AssetCard({ asset }: AssetCardProps) {
  const removeAsset = useAssetStore((s) => s.removeAsset);
  // `source.url` is canonical for both remote-uploaded and free-URL assets —
  // no async resolver needed since we ditched the local IndexedDB blob layer.
  // For soul-id assets the thumbnail is Higgsfield's cover image.
  const thumbUrl =
    asset.kind === "image"
      ? (asset as ImageAsset).source.url
      : asset.kind === "soul-id"
        ? ((asset as SoulIdAsset).thumbnailUrl ?? undefined)
        : undefined;
  const FallbackIcon = asset.kind === "soul-id" ? User : ImageIcon;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          ASSET_DRAG_MIME,
          serializeAssetDrag({ assetId: asset.id, kind: asset.kind }),
        );
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="group/asset relative flex cursor-grab flex-col gap-1 rounded-lg border border-border/60 bg-card/60 p-1.5 transition-colors hover:border-border hover:bg-card active:cursor-grabbing"
      title={asset.name}
    >
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
          alt={asset.name}
          className="aspect-square w-full rounded-md border border-border/40 bg-background/40 object-cover"
          draggable={false}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = "none";
          }}
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-border/40 bg-background/40 text-muted-foreground/50">
          <FallbackIcon className="h-4 w-4" />
        </div>
      )}
      <p className="truncate px-0.5 text-[10.5px] text-foreground/80">
        {asset.name}
      </p>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => removeAsset(asset.id)}
            aria-label={`Delete asset ${asset.name}`}
            className="absolute right-1 top-1 h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover/asset:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Delete asset</TooltipContent>
      </Tooltip>
    </div>
  );
}
