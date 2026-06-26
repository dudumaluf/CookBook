"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Checkerboard backdrop so a transparent PNG (SAM 3 cutout, Image Stack
 * composite, Transform output) reads as *transparent* instead of
 * invisible-on-black. Shared single source of truth — the node bodies,
 * `PreviewImage`, and the full-screen `ImagePreviewModal` all reference
 * this so "transparency" looks identical everywhere.
 */
export const CHECKERBOARD_STYLE: CSSProperties = {
  backgroundColor: "#3a3a3a",
  backgroundImage:
    "linear-gradient(45deg, #4a4a4a 25%, transparent 25%), linear-gradient(-45deg, #4a4a4a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #4a4a4a 75%), linear-gradient(-45deg, transparent 75%, #4a4a4a 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

/**
 * Shared media-preview primitives — "the silhouette is sacred" pattern
 * for image/video/placeholder previews inside node bodies.
 *
 * **Why these exist:** before this module, every media node hand-rolled
 * its own preview wrapper. Some used `aspect-square` and silently
 * cropped 16:9 outputs into squares; some used `object-cover` and
 * silently cropped portrait outputs into landscape; some had no aspect
 * wrapper at all and let intrinsic image size shove the node around. A
 * 1:1 fix to one node didn't propagate to its siblings, and the gallery
 * audit kept finding new variants.
 *
 * **The contract:**
 *   1. **Aspect-ratio first.** The wrapper sets `style={{ aspectRatio }}`
 *      from a single source of truth (config for generators, asset
 *      metadata for inputs, intrinsic dims after `onLoad` for fall-back).
 *      The container sizes itself; the inner media fills the container.
 *   2. **`object-contain` by default.** Resizing a node should never
 *      silently crop the user's content. A 4:3 portrait wired into a
 *      square card letterboxes with a muted background — the content
 *      stays whole and the user can see what they have.
 *   3. **`object-cover` is opt-in.** Comparison / thumbnail tiles where
 *      cropping is part of the affordance pass `fit="cover"` deliberately.
 *   4. **Running / empty placeholders mirror the same aspect.** No more
 *      "loading goes square, then result goes 16:9 and the node jumps".
 *
 * Used by: Fal Image, Higgsfield Image Gen, Image (input), Seedance
 * Video, HeyGen Lipsync, Hunyuan 3D viewer.
 */

const PREVIEW_BASE =
  "block w-full overflow-hidden rounded-md bg-foreground/[0.04]";

/**
 * Tiny pixel-dimension chip overlaid on a media preview, revealed only on
 * hover so it never competes with the content at rest. Top-left corner by
 * design — it clears the native video scrubber (bottom), the `IteratorCursor`
 * (top-right), and the MultiImageView bottom strip.
 *
 * Renders nothing until both dimensions are known (image `onLoad` /
 * video `onLoadedMetadata`), so there's no `0×0` flash. Drop it as an
 * absolutely-positioned child inside any `group relative` media wrapper —
 * the two shared primitives below do this for you; raw-`<img>`/`<video>`
 * node bodies opt in by adding `group relative` + capturing dimensions.
 */
export function DimensionBadge({
  width,
  height,
  className,
}: {
  width?: number | null;
  height?: number | null;
  className?: string;
}) {
  if (!width || !height) return null;
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-1 top-1 z-10 select-none rounded bg-background/75 px-1 py-0.5 font-mono text-[9px] font-medium leading-none text-foreground/80 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100",
        className,
      )}
    >
      {width}×{height}
    </span>
  );
}

interface MediaPreviewImageProps {
  /** URL of the image to render. */
  url: string;
  /** Accessible alt text. Defaults to empty (decorative). */
  alt?: string;
  /**
   * CSS aspect-ratio string like `"16 / 9"`, `"3 / 4"`, `"1 / 1"`.
   * When null/undefined the box adopts the image's INTRINSIC ratio
   * (measured on load) so a 9:16 cutout reads as 9:16 instead of being
   * letterboxed into a square; `"1 / 1"` is only the pre-load placeholder
   * so the container never collapses to zero height.
   */
  aspectRatio?: string | null;
  /**
   * `"contain"` (default) letterboxes; `"cover"` fills + crops.
   * Use `"cover"` only when cropping is the affordance (compare tiles,
   * thumbnail grids). Single-result generator previews always use
   * `"contain"` so users see what they generated.
   */
  fit?: "contain" | "cover";
  /** Click-through behavior. Default: opens the URL in a new tab. */
  href?: string | null;
  /**
   * Paint a checkerboard behind the image so transparent PNGs (cutouts,
   * composites) read as transparent rather than invisible. Default false
   * (opaque generator output doesn't need it).
   */
  checkerboard?: boolean;
  /** Extra classes appended to the wrapper. */
  className?: string;
  /** `data-testid` on the wrapper, for component tests. */
  testId?: string;
  /**
   * Reveal a `W×H` pixel-dimension chip on hover (top-left). Default true —
   * every result preview should let the user read its size without leaving
   * the canvas. Pass `false` for surfaces where it's noise (tiny pickers).
   */
  showDimensions?: boolean;
}

export function MediaPreviewImage({
  url,
  alt,
  aspectRatio,
  fit = "contain",
  href,
  checkerboard = false,
  className,
  testId,
  showDimensions = true,
}: MediaPreviewImageProps) {
  // Intrinsic-ratio fallback: when no explicit `aspectRatio` is given, the
  // box should hug the image's own proportions (a 9:16 cutout must read as
  // 9:16, not letterboxed into a square). The dimensions aren't known until
  // the image loads, so we measure on `onLoad`. Keyed by `url` so a new
  // source ignores the previous measurement instead of flashing a stale
  // ratio. An explicit `aspectRatio` always wins — generators pass their
  // config ratio so the running placeholder + result stay matched.
  const [measured, setMeasured] = useState<{
    url: string;
    w: number;
    h: number;
  } | null>(null);
  const dims = measured?.url === url ? measured : null;
  const intrinsicAspect =
    aspectRatio == null && dims ? `${dims.w} / ${dims.h}` : null;

  const fitClass = fit === "contain" ? "object-contain" : "object-cover";
  const computedHref = href === null ? null : (href ?? url);
  const wrapperClass = cn(PREVIEW_BASE, "group relative", className);
  const style: CSSProperties = {
    aspectRatio: aspectRatio ?? intrinsicAspect ?? "1 / 1",
    ...(checkerboard ? CHECKERBOARD_STYLE : {}),
  };
  const inner = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt ?? ""}
      className={cn("h-full w-full", fitClass)}
      // Measure the natural dimensions once loaded — used for the hover
      // dimension chip always, and for the intrinsic-ratio fallback only
      // when the caller didn't pin an explicit `aspectRatio`.
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setMeasured({ url, w: img.naturalWidth, h: img.naturalHeight });
        }
      }}
      // Bad URLs shouldn't blow out the layout — collapse the broken
      // image to invisible while keeping the container's footprint.
      onError={(e) => {
        (e.target as HTMLImageElement).style.opacity = "0";
      }}
    />
  );

  const badge = showDimensions ? (
    <DimensionBadge width={dims?.w} height={dims?.h} />
  ) : null;

  if (computedHref) {
    return (
      <a
        href={computedHref}
        target="_blank"
        rel="noreferrer noopener"
        // Stop the canvas from interpreting the click as a node drag
        // — same pattern used by every interactive node body element.
        onPointerDown={(e) => e.stopPropagation()}
        className={wrapperClass}
        style={style}
        data-testid={testId}
      >
        {inner}
        {badge}
      </a>
    );
  }

  return (
    <div className={wrapperClass} style={style} data-testid={testId}>
      {inner}
      {badge}
    </div>
  );
}

interface MediaPreviewVideoProps {
  url: string;
  /**
   * Default `"16 / 9"` for video — most clips are landscape. Pass
   * a config-driven aspect when you have one (Seedance config, asset
   * metadata, etc.) so the running placeholder + result match.
   */
  aspectRatio?: string | null;
  /** Show native controls. Default true (preview UX). */
  controls?: boolean;
  /** Loop on the result. Default false — explicit user request. */
  loop?: boolean;
  /** Autoplay muted on hover (gallery thumbnail style). Default false. */
  muted?: boolean;
  className?: string;
  testId?: string;
  /**
   * Reveal a `W×H` pixel-dimension chip on hover (top-left, clear of the
   * scrubber). Default true. Dimensions are read from the decoded video on
   * `loadedmetadata`.
   */
  showDimensions?: boolean;
}

export function MediaPreviewVideo({
  url,
  aspectRatio,
  controls = true,
  loop = false,
  muted = false,
  className,
  testId,
  showDimensions = true,
}: MediaPreviewVideoProps) {
  const [dims, setDims] = useState<{
    url: string;
    w: number;
    h: number;
  } | null>(null);
  const known = dims?.url === url ? dims : null;
  return (
    <div
      className={cn(PREVIEW_BASE, "group relative", className)}
      style={{ aspectRatio: aspectRatio ?? "16 / 9" }}
      data-testid={testId}
    >
      <video
        src={url}
        // `object-contain` matches the image rule — never silently crop a
        // 9:16 vertical video into a 16:9 box.
        className="h-full w-full object-contain"
        controls={controls}
        loop={loop}
        muted={muted}
        playsInline
        preload="metadata"
        onPointerDown={(e) => e.stopPropagation()}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth > 0 && v.videoHeight > 0) {
            setDims({ url, w: v.videoWidth, h: v.videoHeight });
          }
        }}
      />
      {showDimensions ? (
        <DimensionBadge width={known?.w} height={known?.h} />
      ) : null}
    </div>
  );
}

interface MediaPreviewPlaceholderProps {
  /**
   * Same aspect-ratio source as the eventual result, so the running /
   * empty placeholder doesn't snap to a different shape when the
   * result lands. Falls back to `"1 / 1"` for image, `"16 / 9"` for
   * video — but always pass an explicit value when the schema knows
   * (e.g. `parseAspectRatio(config.aspectRatio)?.cssAspect`).
   */
  aspectRatio?: string | null;
  className?: string;
  testId?: string;
  children: ReactNode;
}

export function MediaPreviewPlaceholder({
  aspectRatio,
  className,
  testId,
  children,
}: MediaPreviewPlaceholderProps) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-center rounded-md bg-foreground/[0.04] text-muted-foreground",
        className,
      )}
      style={{ aspectRatio: aspectRatio ?? "1 / 1" }}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
