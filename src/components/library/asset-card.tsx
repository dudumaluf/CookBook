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
import { cn } from "@/lib/utils";
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
 *
 * ## Multi-select (Slice 5.5c)
 *
 * Cards are click-aware:
 *  - **Plain click** → set selection to just this card.
 *  - **Cmd/Ctrl-click** → toggle this card's membership in the selection.
 *  - **Shift-click** → range-select from the last anchor to this card
 *    (matches Finder / Photoshop / Lightroom).
 *
 * Dragging a card writes a multi-payload (`{ assetIds[], kind }`) into
 * `dataTransfer`:
 *  - If the dragged card is **in the current selection**, the payload
 *    carries every selected id (so dragging any one card moves the
 *    whole selection).
 *  - Otherwise the payload carries just this card's id (and the click
 *    that started the drag also resets the selection to just this card —
 *    matches Finder).
 *
 * The multi-asset → canvas drop logic lives in `canvas-flow.tsx`'s
 * `onDrop`: a multi-payload landing on empty canvas spawns a new
 * `image-iterator` populated with all the ids; landing on an existing
 * iterator's body appends to its `assetIds`.
 */
export function AssetCard({ asset }: AssetCardProps) {
  const removeAsset = useAssetStore((s) => s.removeAsset);
  const selectedAssetIds = useAssetStore((s) => s.selectedAssetIds);
  const selectAsset = useAssetStore((s) => s.selectAsset);
  const toggleAssetSelection = useAssetStore((s) => s.toggleAssetSelection);
  const selectAssetRange = useAssetStore((s) => s.selectAssetRange);

  const isSelected = selectedAssetIds.includes(asset.id);

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

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.shiftKey) {
      selectAssetRange(asset.id);
    } else if (event.metaKey || event.ctrlKey) {
      toggleAssetSelection(asset.id);
    } else {
      selectAsset(asset.id);
    }
  }

  function handleDragStart(event: React.DragEvent<HTMLDivElement>) {
    // If the dragged card is part of the current selection, drag the
    // whole selection. Otherwise drag just this card AND reset the
    // selection to it (matches Finder: dragging an unselected file
    // first selects it, then drags it).
    const dragIds = isSelected ? [...selectedAssetIds] : [asset.id];
    if (!isSelected) selectAsset(asset.id);
    event.dataTransfer.setData(
      ASSET_DRAG_MIME,
      serializeAssetDrag({ assetIds: dragIds, kind: asset.kind }),
    );
    event.dataTransfer.effectAllowed = "copy";
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      data-testid="asset-card"
      data-selected={isSelected ? "true" : "false"}
      className={cn(
        "group/asset relative flex cursor-grab flex-col gap-1 rounded-lg border bg-card/60 p-1.5 transition-colors hover:border-border hover:bg-card active:cursor-grabbing",
        isSelected
          ? "border-accent ring-1 ring-accent/40"
          : "border-border/60",
      )}
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
            onClick={(e) => {
              e.stopPropagation();
              removeAsset(asset.id);
            }}
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
