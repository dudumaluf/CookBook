"use client";

import {
  Copy,
  FolderInput,
  Pencil,
  Trash2,
  UserPlus,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useAssetStore } from "@/lib/stores/asset-store";
import type { Asset, AssetGroupAsset } from "@/types/asset";

/**
 * AssetContextMenu — right-click affordance for library cards (Slice 5.6f).
 *
 * Wraps an asset card and exposes kind-aware items that match the user
 * mental model raised in 5.6.1 ("can I right-click an asset to rename or
 * delete it?"). Replaces the absence of a context menu on library cards.
 *
 * Item rules:
 * - Single asset selected (or right-clicked asset is not in selection):
 *   actions act on `asset` only.
 * - Multi-selection that INCLUDES this card: the menu shows "Delete N
 *   items" / "Add N items to group" — Rename is hidden because it has
 *   no plural meaning today (per-asset rename only).
 *
 * Design choices:
 * - Rename is wired through an external `onRequestRename` callback so
 *   the card owns the inline-rename state via `<InlineRename>` and the
 *   menu just triggers it. Keeps gesture and rename concerns separated.
 * - Delete on groups removes the group only — its members survive
 *   (matches `removeGroup` semantics + the in-card Trash button).
 * - "Duplicate group" replaces the Detach-from-group affordance that
 *   was removed in Slice 5.6.1 (per ADR-0032 §8). Creates a new group
 *   with the same `assetIds[]` and a "(copy)" name suffix.
 * - "Add to group" submenu lists existing groups; clicking an entry
 *   appends; "New group…" creates a fresh group containing the
 *   target ids. Group→group merge is silently ignored — same policy
 *   as the in-library drag (ADR-0032 §8).
 * - "Train Soul ID" is shown but disabled with a tooltip-ish hint —
 *   the action lands in M0b. Keeps the affordance discoverable.
 */

export interface AssetContextMenuProps {
  asset: Asset;
  /** Children rendered inside the context-menu trigger. */
  children: ReactNode;
  /** Open the inline rename UI. The card owns the state. */
  onRequestRename: () => void;
}

export function AssetContextMenu({
  asset,
  children,
  onRequestRename,
}: AssetContextMenuProps) {
  const selectedAssetIds = useAssetStore((s) => s.selectedAssetIds);
  const assets = useAssetStore((s) => s.assets);
  const removeAsset = useAssetStore((s) => s.removeAsset);
  const removeAssets = useAssetStore((s) => s.removeAssets);
  const removeGroup = useAssetStore((s) => s.removeGroup);
  const createGroup = useAssetStore((s) => s.createGroup);
  const addToGroup = useAssetStore((s) => s.addToGroup);

  const isInSelection = selectedAssetIds.includes(asset.id);
  const isMulti = isInSelection && selectedAssetIds.length > 1;
  const isGroup = asset.kind === "asset-group";
  const isImage = asset.kind === "image";
  const isSoulId = asset.kind === "soul-id";

  // Active operand set: when the right-click target is part of the
  // current multi-selection, we operate on the whole set; otherwise
  // just on this card. Mirrors how multi-drag picks its payload.
  const operandIds = isMulti ? selectedAssetIds : [asset.id];
  const operandLabel = isMulti
    ? `${operandIds.length} items`
    : asset.name;

  const targetIsImageOnly =
    !isGroup &&
    !isSoulId &&
    operandIds.every((id) => {
      const a = assets.find((x) => x.id === id);
      return a?.kind === "image";
    });

  const groupAssets = useMemo(
    () =>
      assets.filter((a): a is AssetGroupAsset => a.kind === "asset-group"),
    [assets],
  );

  function handleDelete() {
    if (isGroup && !isMulti) {
      removeGroup(asset.id);
      return;
    }
    if (isMulti) {
      void removeAssets(operandIds);
      return;
    }
    void removeAsset(asset.id);
  }

  function handleDuplicateGroup() {
    if (!isGroup) return;
    const group = asset as AssetGroupAsset;
    createGroup({
      name: `${group.name} (copy)`,
      assetIds: group.assetIds,
      isUntitled: false,
    });
  }

  function handleAddToExistingGroup(groupId: string) {
    if (!targetIsImageOnly) return;
    addToGroup(groupId, operandIds);
    useAssetStore.getState().clearAssetSelection();
  }

  function handleAddToNewGroup() {
    if (!targetIsImageOnly) return;
    createGroup({
      assetIds: operandIds,
      isUntitled: true,
    });
    useAssetStore.getState().clearAssetSelection();
  }

  return (
    <ContextMenu>
      {/* `display: contents` so the wrapper div doesn't intercept drag /
          flex layout — visually transparent, but still a real DOM node
          that base-ui can attach the contextmenu listener to. */}
      <ContextMenuTrigger style={{ display: "contents" }}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        data-testid={`asset-context-menu-${asset.kind}`}
        className="min-w-44"
      >
        <ContextMenuGroup>
          <ContextMenuLabel>{operandLabel}</ContextMenuLabel>
        </ContextMenuGroup>
        <ContextMenuSeparator />

        {/* Rename — only meaningful for a single non-multi target */}
        {!isMulti ? (
          <ContextMenuItem
            data-testid="asset-context-menu-rename"
            onClick={onRequestRename}
          >
            <Pencil />
            Rename
          </ContextMenuItem>
        ) : null}

        {/* Add to group — only when operand is image(s); groups + soul-ids
            have no group-membership semantics today */}
        {targetIsImageOnly ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderInput />
              {isMulti ? `Add ${operandIds.length} items to group` : "Add to group"}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                data-testid="asset-context-menu-new-group"
                onClick={handleAddToNewGroup}
              >
                New group…
              </ContextMenuItem>
              {groupAssets.length > 0 ? <ContextMenuSeparator /> : null}
              {groupAssets.map((g) => (
                <ContextMenuItem
                  key={g.id}
                  onClick={() => handleAddToExistingGroup(g.id)}
                >
                  {g.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}

        {/* Duplicate group — replaces the Detach button removed in 5.6.1 */}
        {isGroup && !isMulti ? (
          <ContextMenuItem
            data-testid="asset-context-menu-duplicate-group"
            onClick={handleDuplicateGroup}
          >
            <Copy />
            Duplicate group
          </ContextMenuItem>
        ) : null}

        {/* Train Soul ID — parked for M0b. Visible-but-disabled keeps
            the affordance discoverable. */}
        {isImage && !isMulti ? (
          <ContextMenuItem
            data-testid="asset-context-menu-train-soul-id"
            disabled
            title="Coming in M0b"
          >
            <UserPlus />
            Train Soul ID
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        <ContextMenuItem
          data-testid="asset-context-menu-delete"
          variant="destructive"
          onClick={handleDelete}
        >
          <Trash2 />
          {isMulti
            ? `Delete ${operandIds.length} items`
            : isGroup
              ? "Delete group"
              : "Delete"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
