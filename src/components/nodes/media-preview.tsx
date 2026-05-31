"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

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

interface MediaPreviewImageProps {
  /** URL of the image to render. */
  url: string;
  /** Accessible alt text. Defaults to empty (decorative). */
  alt?: string;
  /**
   * CSS aspect-ratio string like `"16 / 9"`, `"3 / 4"`, `"1 / 1"`.
   * Falls back to `"1 / 1"` if null/undefined — never collapses the
   * container to zero height.
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
  /** Extra classes appended to the wrapper. */
  className?: string;
  /** `data-testid` on the wrapper, for component tests. */
  testId?: string;
}

export function MediaPreviewImage({
  url,
  alt,
  aspectRatio,
  fit = "contain",
  href,
  className,
  testId,
}: MediaPreviewImageProps) {
  const fitClass = fit === "contain" ? "object-contain" : "object-cover";
  const computedHref = href === null ? null : (href ?? url);
  const wrapperClass = cn(PREVIEW_BASE, className);
  const style = { aspectRatio: aspectRatio ?? "1 / 1" } as const;
  const inner = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt ?? ""}
      className={cn("h-full w-full", fitClass)}
      // Bad URLs shouldn't blow out the layout — collapse the broken
      // image to invisible while keeping the container's footprint.
      onError={(e) => {
        (e.target as HTMLImageElement).style.opacity = "0";
      }}
    />
  );

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
      </a>
    );
  }

  return (
    <div className={wrapperClass} style={style} data-testid={testId}>
      {inner}
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
}

export function MediaPreviewVideo({
  url,
  aspectRatio,
  controls = true,
  loop = false,
  muted = false,
  className,
  testId,
}: MediaPreviewVideoProps) {
  return (
    <div
      className={cn(PREVIEW_BASE, className)}
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
      />
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
