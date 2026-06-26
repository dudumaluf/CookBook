"use client";

import { LayoutGrid } from "lucide-react";
import { useMemo } from "react";

import { ImageContextMenu } from "@/components/nodes/image-context-menu";
import type { PreviewModalItem } from "@/components/nodes/image-preview-modal";
import { IteratorCursor } from "@/components/nodes/iterator-cursor";
import { MediaPreviewImage } from "@/components/nodes/media-preview";
import { PreviewImage } from "@/components/nodes/preview-image";
import { cn } from "@/lib/utils";

/**
 * MultiImageView — shared multi-image preview surface for image
 * generation nodes (Fal Image, Higgsfield Image Gen).
 *
 * Two view modes, persisted on the node's config:
 *
 *   "grid"   — 2-column thumbnail grid. Clicking any tile flips the
 *              node to "single" mode focused on that index.
 *
 *   "single" — one large image at `previewIndex`, with a
 *              bottom-overlay strip containing a back-to-grid button
 *              and an `IteratorCursor` (‹ 2 / 4 ›) to walk the batch.
 *              Clicking the image opens the full-screen preview modal
 *              (with Download); right-click downloads it directly.
 *
 * The 1-image and 0-image edges intentionally bypass both views: a
 * single result renders as a plain `MediaPreviewImage` (no toggle,
 * no cursor — there's nothing to navigate). An empty batch renders
 * nothing (the calling node owns the empty / running placeholder).
 *
 * `previewIndex` is clamped on render so the body stays sane after a
 * re-run that returns fewer images. Persisting the index is only a
 * hint; the source of truth on display is `clamp(previewIndex,
 * 0, imageUrls.length - 1)`.
 *
 * Generator nodes wire this in by passing `viewMode` /
 * `previewIndex` from `config` and forwarding `updateConfig` for the
 * persist callbacks. Look at `node-fal-image.tsx` for the canonical
 * usage; Higgsfield mirrors it.
 */
export type MultiImageViewMode = "grid" | "single";

export interface MultiImageViewProps {
  /** Image URLs in batch / fan-out order. Empty array = nothing rendered. */
  imageUrls: string[];
  /** Current view mode. Defaults to `"grid"` when undefined. */
  viewMode?: MultiImageViewMode;
  /** Currently focused image in single mode. Clamped to range on display. */
  previewIndex?: number;
  /** Aspect ratio for the single-mode preview (CSS `aspect-ratio` string). */
  aspectRatio?: string | null;
  /**
   * Per-tile aspect override for the grid. Falls back to `aspectRatio`
   * when omitted. Higgsfield uses `"1 / 1"` here so a 9:16 batch
   * tiles into squares (a curated layout choice — single mode still
   * uses `aspectRatio`). When omitted, every tile mirrors the single
   * preview's aspect.
   */
  gridTileAspectRatio?: string | null;
  /** Persist callback for the view mode. */
  onViewModeChange: (next: MultiImageViewMode) => void;
  /** Persist callback for the focused-image index. */
  onPreviewIndexChange: (next: number) => void;
  /**
   * Optional `data-testid` prefix. When set, several stable hooks
   * are emitted: `${prefix}-grid`, `${prefix}-single`,
   * `${prefix}-tile-${index}`, `${prefix}-back-to-grid`.
   */
  testIdPrefix?: string;
}

export function MultiImageView({
  imageUrls,
  viewMode,
  previewIndex,
  aspectRatio,
  gridTileAspectRatio,
  onViewModeChange,
  onPreviewIndexChange,
  testIdPrefix,
}: MultiImageViewProps) {
  // The whole batch as modal items, so the full-screen preview can walk
  // every image with ‹ › / ← → instead of one-at-a-time. Built before the
  // early returns so the hook order is stable.
  const modalItems = useMemo<PreviewModalItem[]>(
    () =>
      imageUrls.map((url, i) => ({
        url,
        alt: `Generated ${i + 1} of ${imageUrls.length}`,
        downloadName: `generated-${i + 1}`,
      })),
    [imageUrls],
  );

  if (imageUrls.length === 0) return null;

  // Single-image batches don't need either affordance — render the
  // plain preview so the node's silhouette doesn't gain an unused
  // overlay bar. Still clickable → modal + right-click → download.
  if (imageUrls.length === 1) {
    return (
      <PreviewImage
        url={imageUrls[0]!}
        alt="Generated"
        downloadName="generated"
        aspectRatio={aspectRatio}
        fit="contain"
        testId={testIdPrefix ? `${testIdPrefix}-single` : undefined}
      />
    );
  }

  const tileAspect = gridTileAspectRatio ?? aspectRatio;
  const mode: MultiImageViewMode = viewMode ?? "grid";
  const safeIndex = Math.min(
    Math.max(0, Math.trunc(previewIndex ?? 0)),
    imageUrls.length - 1,
  );

  if (mode === "single") {
    const url = imageUrls[safeIndex]!;
    return (
      <div
        className="relative"
        data-testid={testIdPrefix ? `${testIdPrefix}-single` : undefined}
      >
        <PreviewImage
          url={url}
          alt={`Generated ${safeIndex + 1} of ${imageUrls.length}`}
          downloadName={`generated-${safeIndex + 1}`}
          aspectRatio={aspectRatio}
          fit="contain"
          items={modalItems}
          index={safeIndex}
          onIndexChange={onPreviewIndexChange}
        />
        {/* Bottom overlay strip — back-to-grid + iterator cursor.
         *  Sits inside the preview area so the node silhouette
         *  doesn't grow when toggling modes. */}
        <div
          className="pointer-events-none absolute inset-x-1 bottom-1 flex items-center justify-between gap-1.5"
        >
          <button
            type="button"
            aria-label="Back to grid"
            onClick={() => onViewModeChange("grid")}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              "pointer-events-auto flex h-5 items-center justify-center rounded-md bg-background/75 px-1.5 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground",
            )}
            data-testid={
              testIdPrefix ? `${testIdPrefix}-back-to-grid` : undefined
            }
          >
            <LayoutGrid className="h-3 w-3" />
          </button>
          <div className="pointer-events-auto">
            <IteratorCursor
              count={imageUrls.length}
              cursor={safeIndex}
              onCursorChange={onPreviewIndexChange}
              ariaLabelPrefix="Image"
              className="bg-background/75 shadow-sm backdrop-blur-sm"
            />
          </div>
        </div>
      </div>
    );
  }

  // Grid mode — every tile is a button that flips the node to single mode
  // focused on that index (left-click). We deliberately do NOT pass `href`
  // to MediaPreviewImage; the click is owned by the wrapping <button>.
  // Right-click → ImageContextMenu (Download PNG / Open in new tab) so you
  // can grab any tile without leaving the grid.
  return (
    <div
      className="grid grid-cols-2 gap-1.5"
      data-testid={testIdPrefix ? `${testIdPrefix}-grid` : undefined}
    >
      {imageUrls.map((url, i) => (
        <ImageContextMenu
          key={`${url}-${i}`}
          url={url}
          downloadName={`generated-${i + 1}`}
        >
          <button
            type="button"
            onClick={() => {
              onPreviewIndexChange(i);
              onViewModeChange("single");
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Preview image ${i + 1} of ${imageUrls.length}`}
            className="group relative overflow-hidden rounded-md ring-0 ring-foreground/0 transition-all hover:ring-2 hover:ring-foreground/20"
            data-testid={
              testIdPrefix ? `${testIdPrefix}-tile-${i}` : undefined
            }
          >
            <MediaPreviewImage
              url={url}
              alt={`Generated ${i + 1}`}
              aspectRatio={tileAspect}
              fit="contain"
              href={null}
            />
          </button>
        </ImageContextMenu>
      ))}
    </div>
  );
}
