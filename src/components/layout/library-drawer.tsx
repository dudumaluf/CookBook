"use client";

import { ArrowLeft, Download, FolderPlus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AssetView } from "@/components/library/asset-view";
import {
  LibraryToolbar,
  type LibraryChip,
} from "@/components/library/library-toolbar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { downloadFromUrl, safeFilename } from "@/lib/library/download";
import { filterAssets } from "@/lib/library/filter-assets";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import type {
  Asset,
  AssetGroupAsset,
  ImageAsset,
  MediaAssetSource,
} from "@/types/asset";

/**
 * LibraryDrawer (Library revamp) — a bottom drawer (~72vh) that mirrors the
 * Gallery drawer for fuller asset management. Reuses the shared
 * `LibraryToolbar` + `AssetView`; selection lives in the asset-store (same
 * as the side panel), so a bulk action bar appears when items are selected.
 *
 * Drag-to-canvas works via the same pointer-events trick the Gallery uses:
 * while a card is being dragged, the full-viewport wrapper goes
 * `pointer-events-none` so the drop reaches the canvas underneath without
 * unmounting the drawer (which would abort the drag).
 */

const SECTION_DEFS: Array<{ id: Asset["kind"]; title: string }> = [
  { id: "soul-id", title: "Soul IDs" },
  { id: "asset-group", title: "Groups" },
  { id: "image", title: "Images" },
  { id: "video", title: "Videos" },
  { id: "audio", title: "Audio" },
];

export function LibraryDrawer() {
  const open = useLayoutStore((s) => s.libraryDrawerOpen);
  const setOpen = useLayoutStore((s) => s.setLibraryDrawerOpen);
  const view = useLayoutStore((s) => s.libraryView);
  const thumb = useLayoutStore((s) => s.libraryThumb);
  const setView = useLayoutStore((s) => s.setLibraryView);
  const setThumb = useLayoutStore((s) => s.setLibraryThumb);

  const assets = useAssetStore((s) => s.assets);
  const selectedAssetIds = useAssetStore((s) => s.selectedAssetIds);
  const clearSelection = useAssetStore((s) => s.clearAssetSelection);
  const removeAssets = useAssetStore((s) => s.removeAssets);
  const createGroup = useAssetStore((s) => s.createGroup);

  const [query, setQuery] = useState("");
  const [activeChip, setActiveChip] = useState("all");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Esc closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const base = useMemo(() => {
    const images = assets.filter((a): a is ImageAsset => a.kind === "image");
    const groups = assets.filter(
      (a): a is AssetGroupAsset => a.kind === "asset-group",
    );
    const groupedIds = new Set(groups.flatMap((g) => g.assetIds));
    return {
      image: images.filter((a) => !groupedIds.has(a.id)) as Asset[],
      "asset-group": groups as Asset[],
      "soul-id": assets.filter((a) => a.kind === "soul-id"),
      video: assets.filter((a) => a.kind === "video"),
      audio: assets.filter((a) => a.kind === "audio"),
    };
  }, [assets]);

  const filtered = useMemo(
    () => ({
      image: filterAssets(base.image, { query }),
      "asset-group": filterAssets(base["asset-group"], { query }),
      "soul-id": filterAssets(base["soul-id"], { query }),
      video: filterAssets(base.video, { query }),
      audio: filterAssets(base.audio, { query }),
    }),
    [base, query],
  );

  const chips = useMemo<LibraryChip[]>(() => {
    const defs = SECTION_DEFS.map((s) => ({
      id: s.id,
      label: s.id === "soul-id" ? "Soul IDs" : `${s.title}`,
      count: base[s.id].length,
    }));
    const present = defs.filter((d) => d.count > 0);
    const total = present.reduce((n, d) => n + d.count, 0);
    return [{ id: "all", label: "All", count: total }, ...present];
  }, [base]);

  const totalCount = assets.length;
  const selectedCount = selectedAssetIds.length;

  const activeGroup =
    activeGroupId !== null
      ? (assets.find(
          (a): a is AssetGroupAsset =>
            a.id === activeGroupId && a.kind === "asset-group",
        ) ?? null)
      : null;

  function handleOpen(asset: Asset) {
    if (asset.kind === "asset-group") setActiveGroupId(asset.id);
  }

  /* ──────────── Bulk actions ──────────── */

  async function bulkDelete() {
    if (
      !window.confirm(
        `Delete ${selectedCount} ${selectedCount === 1 ? "asset" : "assets"}? This can't be undone.`,
      )
    )
      return;
    const ids = [...selectedAssetIds];
    await removeAssets(ids);
    clearSelection();
    toast.success(`Deleted ${ids.length}`);
  }

  function bulkGroup() {
    const imageIds = selectedAssetIds.filter((id) => {
      const a = assets.find((x) => x.id === id);
      return a?.kind === "image";
    });
    if (imageIds.length === 0) {
      toast.error("Select images to group");
      return;
    }
    createGroup({ assetIds: imageIds });
    clearSelection();
    toast.success(`Grouped ${imageIds.length} image${imageIds.length === 1 ? "" : "s"}`);
  }

  async function bulkDownload() {
    const targets = assets.filter((a) => selectedAssetIds.includes(a.id));
    for (const asset of targets) {
      const url =
        asset.kind === "image"
          ? asset.source.url
          : asset.kind === "video" || asset.kind === "audio"
            ? (asset.source as MediaAssetSource).url
            : null;
      if (!url) continue;
      const ext =
        asset.kind === "video" ? "mp4" : asset.kind === "audio" ? "wav" : "png";
      try {
        await downloadFromUrl(url, `${safeFilename(asset.name)}.${ext}`);
      } catch (err) {
        console.warn("[library] download failed:", err);
        toast.error(`Could not download ${asset.name}`);
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  if (!open) return null;

  const show = (id: string) => activeChip === "all" || activeChip === id;
  const visibleSections = SECTION_DEFS.filter(
    (s) => show(s.id) && filtered[s.id].length > 0,
  );

  const groupMembers: ImageAsset[] = activeGroup
    ? (activeGroup.assetIds
        .map((id) => assets.find((a) => a.id === id && a.kind === "image"))
        .filter(Boolean) as ImageAsset[])
    : [];

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-stretch ${
        isDragging ? "pointer-events-none" : ""
      }`}
    >
      <button
        type="button"
        aria-label="Close library"
        onClick={() => setOpen(false)}
        className={`flex-1 cursor-default bg-background/60 backdrop-blur-sm ${
          isDragging ? "pointer-events-none" : ""
        }`}
      />
      <section
        aria-label="Library"
        data-testid="library-drawer"
        onDragStartCapture={() => setIsDragging(true)}
        onDragEndCapture={() => setIsDragging(false)}
        className="flex h-[72vh] flex-col rounded-t-3xl border-t border-border/80 bg-popover/95 shadow-2xl shadow-black/60 backdrop-blur-md"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1 w-10 rounded-full bg-border" aria-hidden />
            {activeGroup ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setActiveGroupId(null)}
                aria-label="Back to library"
                className="h-6 w-6 text-muted-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            <h2 className="text-sm font-medium text-foreground">
              {activeGroup ? activeGroup.name : "Library"}
            </h2>
            <span className="text-xs text-muted-foreground">
              {activeGroup
                ? `${groupMembers.length} ${groupMembers.length === 1 ? "image" : "images"}`
                : `${totalCount} ${totalCount === 1 ? "item" : "items"}`}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close library"
                onClick={() => setOpen(false)}
                className="h-7 w-7 rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        </header>

        {activeGroup ? null : (
          <div className="border-b border-border/40 px-5 py-3">
            <LibraryToolbar
              query={query}
              onQueryChange={setQuery}
              chips={chips}
              activeChip={activeChip}
              onChipChange={setActiveChip}
              view={view}
              onViewChange={setView}
              thumb={thumb}
              onThumbChange={setThumb}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeGroup ? (
            groupMembers.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                This group is empty.
              </p>
            ) : (
              <AssetView assets={groupMembers} view={view} size={thumb} />
            )
          ) : visibleSections.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {query.trim() || activeChip !== "all"
                ? "No matching assets."
                : "No assets yet."}
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {visibleSections.map((s) => (
                <section key={s.id} className="flex flex-col gap-2">
                  <header className="flex items-center gap-2">
                    <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {s.title}
                    </h3>
                    <span className="text-[10.5px] tabular-nums text-muted-foreground/70">
                      {filtered[s.id].length}
                    </span>
                  </header>
                  <AssetView
                    assets={filtered[s.id]}
                    view={view}
                    size={thumb}
                    onOpen={handleOpen}
                  />
                </section>
              ))}
            </div>
          )}
        </div>

        {selectedCount > 0 ? (
          <div
            data-testid="library-bulk-bar"
            className="flex items-center justify-between gap-3 border-t border-border/60 bg-background/60 px-5 py-2.5"
          >
            <span className="text-xs text-muted-foreground">
              {selectedCount} selected
            </span>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={bulkGroup} className="gap-1.5">
                <FolderPlus className="h-3.5 w-3.5" />
                Group
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void bulkDownload()}
                className="gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void bulkDelete()}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
