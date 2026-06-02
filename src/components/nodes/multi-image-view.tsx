"use client";

import { LayoutGrid } from "lucide-react";

import { IteratorCursor } from "@/components/nodes/iterator-cursor";
import { MediaPreviewImage } from "@/components/nodes/media-preview";
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
 *              The single image keeps its native click-to-open-tab
 *              behaviour so users can still pop it out full-size.
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
  if (imageUrls.length === 0) return null;

  // Single-image batches don't need either affordance — render the
  // plain preview so the node's silhouette doesn't gain an unused
  // overlay bar.
  if (imageUrls.length === 1) {
    return (
      <MediaPreviewImage
        url={imageUrls[0]!}
        alt="Generated"
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
        <MediaPreviewImage
          url={url}
          alt={`Generated ${safeIndex + 1} of ${imageUrls.length}`}
          aspectRatio={aspectRatio}
          fit="contain"
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

  // Grid mode — every tile is a button that flips the node to
  // single mode focused on that index. We deliberately do NOT pass
  // `href` to MediaPreviewImage in grid mode; opening every tile in
  // a new tab is a foot-gun when the user is just trying to pick
  // one to inspect closer. Single mode keeps the open-in-new-tab
  // affordance for "I want to see this full size".
  return (
    <div
      className="grid grid-cols-2 gap-1.5"
      data-testid={testIdPrefix ? `${testIdPrefix}-grid` : undefined}
    >
      {imageUrls.map((url, i) => (
        <button
          key={`${url}-${i}`}
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
            // Suppress the new-tab anchor — the click is owned by
            // the wrapping <button> so the click lands on
            // onPreviewIndexChange / onViewModeChange.
            href={null}
          />
        </button>
      ))}
    </div>
  );
}
