"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { importImageFiles } from "@/lib/library/import-files";
import { useAssetStore } from "@/lib/stores/asset-store";
import type {
  Asset,
  AssetGroupAsset,
  ImageAsset,
  SoulIdAsset,
} from "@/types/asset";

import { AssetCard } from "./asset-card";
import { ImportAsGroupDialog } from "./import-as-group-dialog";
import { InlineRename } from "./inline-rename";

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
 *
 * ## Groups subview (Slice 5.6b)
 *
 * Double-clicking a group card flips this component into a subview that
 * shows the group's images in the same 2-column grid, with a back arrow
 * + the group's name in the header. Going back restores the top-level
 * view. The subview state is purely local — no store change — so
 * navigating in/out doesn't pollute persisted state.
 */
export function LibraryContent() {
  const assets = useAssetStore((s) => s.assets);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  /** "Import as group?" dialog state — see Slice 5.6c. */
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Slice 5.6f — multi-delete via Backspace / Delete.
  //
  // Listens at the panel root so the keyboard works whenever the user
  // is "in the library" (mouse hovered, focus inside, etc.). We bail
  // when focus is in an input / textarea / contenteditable so we don't
  // intercept typing in the inline-rename or any future filter input.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        const tag = active.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          active.isContentEditable
        ) {
          return;
        }
      }
      const ids = useAssetStore.getState().selectedAssetIds;
      if (ids.length === 0) return;
      event.preventDefault();
      void useAssetStore.getState().removeAssets(ids);
      useAssetStore.getState().clearAssetSelection();
      toast.success(
        `Deleted ${ids.length} ${ids.length === 1 ? "asset" : "assets"}`,
      );
    }
    // Only fire when the keystroke originated within this panel — using
    // a window listener would snipe Backspace from the canvas.
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, []);

  // Re-resolve the group on every render so renames / membership
  // changes propagate while inside the subview. If the active group
  // was deleted (e.g. cleanup-on-iterator-delete fired), this returns
  // null and the render falls through to the top-level view — the
  // stale activeGroupId stays in state harmlessly until the user
  // navigates next, at which point setActiveGroupId rewrites it.
  const activeGroup =
    activeGroupId !== null
      ? (assets.find(
          (a): a is AssetGroupAsset =>
            a.id === activeGroupId && a.kind === "asset-group",
        ) ?? null)
      : null;

  function handleAssetOpen(asset: Asset) {
    if (asset.kind === "asset-group") {
      setActiveGroupId(asset.id);
    }
  }

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setIsDropTarget(false);
    const list = Array.from(event.dataTransfer.files);
    if (list.length === 0) return;
    if (list.length === 1) {
      // Single-file drop: import straight, no dialog.
      const result = await importImageFiles(list);
      if (result.created > 0) {
        toast.success(
          `${result.created} image${result.created === 1 ? "" : "s"} added to Library`,
        );
      }
      for (const err of result.errors) toast.error(err);
      return;
    }
    // 2+ files: ask the user via the dialog.
    setPendingFiles(list);
  }

  return (
    <div
      ref={containerRef}
      // tabIndex makes this div a focusable container so keydown bubbles
      // up to the listener installed in `useEffect` above. We do NOT
      // visibly outline-on-focus — the focus is purely for keyboard
      // routing. Cards inside still capture clicks normally.
      tabIndex={-1}
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
      className={`relative flex flex-col gap-3 px-3 py-3 transition-colors outline-none ${
        isDropTarget ? "bg-accent/5" : ""
      }`}
    >
      {activeGroup ? (
        <GroupSubview
          group={activeGroup}
          allAssets={assets}
          onBack={() => setActiveGroupId(null)}
        />
      ) : (
        <TopLevelView
          assets={assets}
          onAssetOpen={handleAssetOpen}
        />
      )}
      <ImportAsGroupDialog
        files={pendingFiles}
        onClose={() => setPendingFiles(null)}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Top-level view: Soul IDs + Groups + Images                              */
/* ────────────────────────────────────────────────────────────────────── */

function TopLevelView({
  assets,
  onAssetOpen,
}: {
  assets: Asset[];
  onAssetOpen: (asset: Asset) => void;
}) {
  const imageAssets = assets.filter(
    (a): a is ImageAsset => a.kind === "image",
  );
  const soulIdAssets = assets.filter(
    (a): a is SoulIdAsset => a.kind === "soul-id",
  );
  const groupAssets = assets.filter(
    (a): a is AssetGroupAsset => a.kind === "asset-group",
  );

  // Slice 5.6.1 — images that are members of any group hide from the
  // top-level "Images" section. The user enters the group via the
  // subview to see them. removeFromGroup / removeGroup brings them
  // back to Images naturally because the filter re-evaluates. Matches
  // Finder's folder model: a file lives in one place at a time.
  const groupedImageIds = new Set(
    groupAssets.flatMap((g) => g.assetIds),
  );
  const bareImageAssets = imageAssets.filter(
    (a) => !groupedImageIds.has(a.id),
  );

  if (
    bareImageAssets.length === 0 &&
    soulIdAssets.length === 0 &&
    groupAssets.length === 0
  ) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <p className="text-sm text-foreground/80">No assets yet</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Click <span className="font-medium text-foreground/80">+</span> to
          upload from disk, or drop images right here. Drag a card onto the
          canvas to spawn an Image node already linked.
        </p>
      </div>
    );
  }

  return (
    <>
      {soulIdAssets.length > 0 ? (
        <Section title="Soul IDs" count={soulIdAssets.length}>
          <div className="grid grid-cols-2 gap-1.5">
            {soulIdAssets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} onOpen={onAssetOpen} />
            ))}
          </div>
        </Section>
      ) : null}
      {groupAssets.length > 0 ? (
        <Section
          title="Groups"
          count={groupAssets.length}
          dataTestId="library-section-groups"
        >
          <div className="grid grid-cols-2 gap-1.5">
            {groupAssets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} onOpen={onAssetOpen} />
            ))}
          </div>
        </Section>
      ) : null}
      {bareImageAssets.length > 0 ? (
        <Section title="Images" count={bareImageAssets.length}>
          <div className="grid grid-cols-2 gap-1.5">
            {bareImageAssets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} onOpen={onAssetOpen} />
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Group subview: back arrow + group name + grid of the group's images     */
/* ────────────────────────────────────────────────────────────────────── */

function GroupSubview({
  group,
  allAssets,
  onBack,
}: {
  group: AssetGroupAsset;
  allAssets: Asset[];
  onBack: () => void;
}) {
  const renameGroup = useAssetStore((s) => s.renameGroup);
  // Resolve the group's image members in order; drop ids that don't
  // resolve so the grid degrades gracefully if an image was deleted.
  const memberAssets: ImageAsset[] = [];
  for (const id of group.assetIds) {
    const asset = allAssets.find((a) => a.id === id && a.kind === "image");
    if (asset?.kind === "image") memberAssets.push(asset);
  }

  return (
    <div data-testid="library-group-subview" className="flex flex-col gap-2">
      <header className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to library"
          data-testid="library-group-subview-back"
          className="h-6 w-6 text-muted-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="min-w-0 flex-1">
          <InlineRename
            value={group.name}
            onCommit={(next) => renameGroup(group.id, next)}
            ariaLabel={`Rename group ${group.name}`}
            inputClassName="w-full rounded-sm bg-background/70 px-1 py-px text-xs text-foreground outline-none ring-1 ring-accent/60"
            renderLabel={({ startEditing }) => (
              <h3
                onDoubleClick={startEditing}
                title="Double-click to rename"
                className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90"
              >
                {group.name}
                {group.isUntitled ? (
                  <span className="ml-1 rounded bg-foreground/[0.05] px-1 py-px text-[9px] text-muted-foreground">
                    Untitled
                  </span>
                ) : null}
              </h3>
            )}
          />
        </div>
        <span className="text-[10.5px] tabular-nums text-muted-foreground/70">
          {group.assetIds.length}
        </span>
      </header>
      {memberAssets.length === 0 ? (
        <p className="px-0.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          This group is empty.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {memberAssets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Section helper                                                          */
/* ────────────────────────────────────────────────────────────────────── */

function Section({
  title,
  count,
  children,
  dataTestId,
}: {
  title: string;
  count: number;
  children: ReactNode;
  dataTestId?: string;
}) {
  return (
    <section
      className="flex flex-col gap-1.5"
      data-testid={dataTestId}
    >
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
