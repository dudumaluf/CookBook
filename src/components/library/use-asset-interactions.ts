"use client";

import { useRef, useState } from "react";

import {
  ASSET_DRAG_MIME,
  parseAssetDrag,
  serializeAssetDrag,
} from "@/lib/library/asset-drag";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { Asset } from "@/types/asset";

/**
 * Shared asset-card interaction logic (Library revamp). Both the grid
 * `AssetCard` and the list `AssetRow` need identical multi-select, drag,
 * group-drop, delete, and inline-rename behaviour — this hook is the single
 * source of truth so the two views never drift.
 */
export function useAssetInteractions(
  asset: Asset,
  onOpen?: (asset: Asset) => void,
) {
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

  const startInlineRenameRef = useRef<(() => void) | null>(null);
  function requestRename() {
    startInlineRenameRef.current?.();
  }

  function handleRename(next: string) {
    if (asset.kind === "asset-group") renameGroup(asset.id, next);
    else updateAsset(asset.id, { name: next });
  }

  const [isDropTarget, setIsDropTarget] = useState(false);

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    if (!isGroup) return;
    if (!event.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTarget(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!isGroup) return;
    if (event.currentTarget === event.target) setIsDropTarget(false);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    if (!isGroup) return;
    setIsDropTarget(false);
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME);
    if (!raw) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = parseAssetDrag(raw);
    if (!payload || payload.kind !== "image") return;
    if (payload.assetIds.length === 0) return;
    addToGroup(asset.id, payload.assetIds);
    useAssetStore.getState().clearAssetSelection();
  }

  function handleClick(event: React.MouseEvent<HTMLElement>) {
    if (event.shiftKey) selectAssetRange(asset.id);
    else if (event.metaKey || event.ctrlKey) toggleAssetSelection(asset.id);
    else selectAsset(asset.id);
  }

  function handleDoubleClick() {
    onOpen?.(asset);
  }

  function handleDragStart(event: React.DragEvent<HTMLElement>) {
    const dragIds = isSelected ? [...selectedAssetIds] : [asset.id];
    if (!isSelected) selectAsset(asset.id);
    event.dataTransfer.setData(
      ASSET_DRAG_MIME,
      serializeAssetDrag({ assetIds: dragIds, kind: asset.kind }),
    );
    event.dataTransfer.effectAllowed = "copy";
  }

  function handleDelete() {
    if (isGroup) removeGroup(asset.id);
    else void removeAsset(asset.id);
  }

  return {
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
  };
}
