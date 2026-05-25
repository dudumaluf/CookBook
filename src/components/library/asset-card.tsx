"use client";

import { Image as ImageIcon, Trash2, User } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ASSET_DRAG_MIME,
  parseAssetDrag,
  serializeAssetDrag,
} from "@/lib/library/asset-drag";
import { useAssetStore } from "@/lib/stores/asset-store";
import { cn } from "@/lib/utils";
import type {
  Asset,
  AssetGroupAsset,
  ImageAsset,
  SoulIdAsset,
} from "@/types/asset";

import { AssetContextMenu } from "./asset-context-menu";
import { InlineRename } from "./inline-rename";

interface AssetCardProps {
  asset: Asset;
  /** Optional click override — used by the group subview's "open" semantic. */
  onOpen?: (asset: Asset) => void;
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
 * ## Group cards (Slice 5.6b)
 *
 * `kind: "asset-group"` cards render a 2×2 mosaic of up to 4 image
 * thumbnails (the first 4 entries in `group.assetIds`, resolved
 * through the asset store). A count badge in the corner shows the
 * total. Double-click commits an inline rename. Drag of a group card
 * carries `kind: "asset-group"` so the dispatcher routes it to spawn an
 * `image-iterator` linked via `groupId`.
 */
export function AssetCard({ asset, onOpen }: AssetCardProps) {
  const removeAsset = useAssetStore((s) => s.removeAsset);
  const removeGroup = useAssetStore((s) => s.removeGroup);
  const renameGroup = useAssetStore((s) => s.renameGroup);
  const updateAsset = useAssetStore((s) => s.updateAsset);
  const addToGroup = useAssetStore((s) => s.addToGroup);
  const selectedAssetIds = useAssetStore((s) => s.selectedAssetIds);
  const selectAsset = useAssetStore((s) => s.selectAsset);
  const toggleAssetSelection = useAssetStore((s) => s.toggleAssetSelection);
  const selectAssetRange = useAssetStore((s) => s.selectAssetRange);

  const isSelected = selectedAssetIds.includes(asset.id);
  const isGroup = asset.kind === "asset-group";

  // Imperative handle into <InlineRename> — lets the right-click context
  // menu's Rename item open edit mode without lifting the editing state
  // up into AssetCard.
  const startInlineRenameRef = useRef<(() => void) | null>(null);
  function handleRequestRename() {
    startInlineRenameRef.current?.();
  }

  function handleRename(next: string) {
    if (asset.kind === "asset-group") {
      renameGroup(asset.id, next);
    } else {
      updateAsset(asset.id, { name: next });
    }
  }

  // Slice 5.6.1b — group cards become drop targets for image drags
  // INSIDE the library. Drop an image card on a group card and the
  // group's `assetIds` grows. Mirrors Finder ("drag file into folder").
  // Only image payloads accepted today; other kinds (group→group merge,
  // soul-id) are ignored, leaving the surface free for Slice 5.6f's
  // right-click menu to introduce them explicitly.
  const [isDropTarget, setIsDropTarget] = useState(false);

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!isGroup) return;
    if (!event.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTarget(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!isGroup) return;
    if (event.currentTarget === event.target) setIsDropTarget(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!isGroup) return;
    setIsDropTarget(false);
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME);
    if (!raw) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = parseAssetDrag(raw);
    // Only image-kind payloads merge into groups (5.6.1b).
    // group→group / soul-id silently ignored — those operations belong
    // to the future right-click menu (Slice 5.6f).
    if (!payload || payload.kind !== "image") return;
    // Don't drag a card onto its own group (no-op even though
    // addToGroup is de-duped — explicit guard avoids visual flicker).
    if (payload.assetIds.length === 0) return;
    addToGroup(asset.id, payload.assetIds);
    // Clear library selection so the next click starts fresh
    // (matches the canvas-flow drop behaviour).
    useAssetStore.getState().clearAssetSelection();
  }

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.shiftKey) {
      selectAssetRange(asset.id);
    } else if (event.metaKey || event.ctrlKey) {
      toggleAssetSelection(asset.id);
    } else {
      selectAsset(asset.id);
    }
  }

  function handleDoubleClick() {
    if (onOpen) onOpen(asset);
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

  function handleDelete() {
    if (isGroup) {
      removeGroup(asset.id);
    } else {
      void removeAsset(asset.id);
    }
  }

  return (
    <AssetContextMenu asset={asset} onRequestRename={handleRequestRename}>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        data-testid="asset-card"
        data-asset-kind={asset.kind}
        data-selected={isSelected ? "true" : "false"}
        data-drop-target={isDropTarget ? "true" : "false"}
        className={cn(
          "group/asset relative flex cursor-grab flex-col gap-1 rounded-lg border bg-card/60 p-1.5 transition-colors hover:border-border hover:bg-card active:cursor-grabbing",
          isSelected
            ? "border-accent ring-1 ring-accent/40"
            : isDropTarget
              ? "border-accent/70 bg-accent/5 ring-1 ring-accent/30"
              : "border-border/60",
        )}
        title={asset.name}
      >
        <CardThumbnail asset={asset} />

        <InlineRename
          value={asset.name}
          onCommit={handleRename}
          ariaLabel={
            isGroup
              ? `Rename group ${asset.name}`
              : `Rename asset ${asset.name}`
          }
          startEditingRef={startInlineRenameRef}
          renderLabel={({ startEditing }) => (
            <p
              onDoubleClick={
                isGroup ? startEditing : (e) => e.stopPropagation()
              }
              className="truncate px-0.5 text-[10.5px] text-foreground/80"
              // Only group cards advertise "double-click to rename" via
              // tooltip — image / soul-id renames go through the
              // right-click context menu's Rename item to keep the
              // double-click slot free for canvas open / future preview.
              title={isGroup ? "Double-click to rename" : undefined}
            >
              {asset.name}
              {isGroup && (asset as AssetGroupAsset).isUntitled ? (
                <span
                  data-testid="asset-group-untitled-badge"
                  className="ml-1 rounded bg-foreground/[0.05] px-1 py-px text-[9px] text-muted-foreground"
                >
                  Untitled
                </span>
              ) : null}
            </p>
          )}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              aria-label={
                isGroup
                  ? `Delete group ${asset.name}`
                  : `Delete asset ${asset.name}`
              }
              className="absolute right-1 top-1 h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover/asset:opacity-100"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {isGroup ? "Delete group" : "Delete asset"}
          </TooltipContent>
        </Tooltip>
      </div>
    </AssetContextMenu>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Thumbnail (per-kind branch)                                            */
/* ────────────────────────────────────────────────────────────────────── */

function CardThumbnail({ asset }: { asset: Asset }) {
  if (asset.kind === "asset-group") {
    return <GroupMosaic group={asset} />;
  }
  // Image / Soul ID — single thumbnail.
  const thumbUrl =
    asset.kind === "image"
      ? (asset as ImageAsset).source.url
      : asset.kind === "soul-id"
        ? ((asset as SoulIdAsset).thumbnailUrl ?? undefined)
        : undefined;
  const FallbackIcon = asset.kind === "soul-id" ? User : ImageIcon;

  if (thumbUrl) {
    return (
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
    );
  }
  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-border/40 bg-background/40 text-muted-foreground/50">
      <FallbackIcon className="h-4 w-4" />
    </div>
  );
}

/**
 * 2×2 mosaic of up to 4 image thumbnails, stitched from the group's
 * `assetIds`. Falls back to icon glyph for missing slots / empty group.
 * Top-right count badge shows the total.
 */
function GroupMosaic({ group }: { group: AssetGroupAsset }) {
  const assets = useAssetStore((s) => s.assets);
  // Resolve up to 4 image urls in order. Skip ids that don't resolve to
  // an image asset (defensive against stale references).
  const previewUrls: string[] = [];
  for (const id of group.assetIds) {
    if (previewUrls.length >= 4) break;
    const asset = assets.find((a) => a.id === id && a.kind === "image");
    if (asset?.kind === "image") {
      previewUrls.push(asset.source.url);
    }
  }
  const total = group.assetIds.length;

  return (
    <div
      data-testid="asset-group-mosaic"
      className="relative aspect-square w-full overflow-hidden rounded-md border border-border/40 bg-background/40"
    >
      {previewUrls.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
          <ImageIcon className="h-4 w-4" />
        </div>
      ) : (
        <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px">
          {previewUrls.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${url}-${i}`}
              src={url}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0";
              }}
            />
          ))}
          {/* Fill empty slots with a muted background so the 2×2 grid
              keeps its silhouette even when the group has fewer than 4
              previewable items. */}
          {Array.from({ length: 4 - previewUrls.length }, (_, i) => (
            <div
              key={`empty-${i}`}
              className="h-full w-full bg-foreground/[0.02]"
            />
          ))}
        </div>
      )}
      {/* Count badge — total items in the group, regardless of how
          many are renderable in the preview. */}
      {total > 0 ? (
        <span
          data-testid="asset-group-count-badge"
          className="absolute right-1 top-1 rounded-md bg-background/80 px-1 py-px text-[9.5px] font-medium text-foreground/85 backdrop-blur"
        >
          {total}
        </span>
      ) : null}
    </div>
  );
}

