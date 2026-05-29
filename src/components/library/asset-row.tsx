"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Asset, AssetGroupAsset } from "@/types/asset";

import { AssetContextMenu } from "./asset-context-menu";
import { CardThumbnail } from "./asset-card";
import { InlineRename } from "./inline-rename";
import { useAssetInteractions } from "./use-asset-interactions";

const KIND_LABEL: Record<Asset["kind"], string> = {
  image: "Image",
  "soul-id": "Soul ID",
  "asset-group": "Group",
  video: "Video",
  audio: "Audio",
};

/**
 * AssetRow — the dense list-view counterpart of `AssetCard` (Library
 * revamp). Same interactions (multi-select, drag, group-drop, delete,
 * inline rename) via the shared `useAssetInteractions` hook; just a row
 * layout: small thumb + name + kind label + hover delete.
 */
export function AssetRow({
  asset,
  onOpen,
}: {
  asset: Asset;
  onOpen?: (asset: Asset) => void;
}) {
  const {
    isSelected,
    isGroup,
    isDropTarget,
    startInlineRenameRef,
    requestRename,
    handleRename,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleClick,
    handleDoubleClick,
    handleDragStart,
    handleDelete,
  } = useAssetInteractions(asset, onOpen);

  const groupCount =
    asset.kind === "asset-group" ? (asset as AssetGroupAsset).assetIds.length : null;

  return (
    <AssetContextMenu asset={asset} onRequestRename={requestRename}>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        data-testid="asset-row"
        data-asset-kind={asset.kind}
        data-selected={isSelected ? "true" : "false"}
        data-drop-target={isDropTarget ? "true" : "false"}
        title={asset.name}
        className={cn(
          "group/asset relative flex cursor-grab items-center gap-2 rounded-lg border bg-card/50 px-2 py-1.5 transition-colors hover:bg-card active:cursor-grabbing",
          isSelected
            ? "border-accent ring-1 ring-accent/40"
            : isDropTarget
              ? "border-accent/70 bg-accent/5 ring-1 ring-accent/30"
              : "border-border/50",
        )}
      >
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md">
          <CardThumbnail asset={asset} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <InlineRename
            value={asset.name}
            onCommit={handleRename}
            ariaLabel={
              isGroup ? `Rename group ${asset.name}` : `Rename asset ${asset.name}`
            }
            startEditingRef={startInlineRenameRef}
            inputClassName="w-full rounded-sm bg-background/70 px-1 py-px text-xs text-foreground outline-none ring-1 ring-accent/60"
            renderLabel={({ startEditing }) => (
              <p
                onDoubleClick={
                  isGroup ? startEditing : (e) => e.stopPropagation()
                }
                className="truncate text-xs text-foreground/85"
                title={isGroup ? "Double-click to rename" : undefined}
              >
                {asset.name}
              </p>
            )}
          />
          <span className="text-[10px] text-muted-foreground">
            {KIND_LABEL[asset.kind]}
            {groupCount !== null ? ` · ${groupCount}` : ""}
          </span>
        </div>
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
                isGroup ? `Delete group ${asset.name}` : `Delete asset ${asset.name}`
              }
              className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/asset:opacity-100"
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
