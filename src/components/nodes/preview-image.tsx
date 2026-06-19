"use client";

import { useState } from "react";

import { ImageContextMenu } from "@/components/nodes/image-context-menu";
import { ImagePreviewModal } from "@/components/nodes/image-preview-modal";
import { MediaPreviewImage } from "@/components/nodes/media-preview";
import { cn } from "@/lib/utils";

/**
 * PreviewImage — the standard node-body image preview.
 *
 * One surface, three affordances every result image should have:
 *   1. **Click → full-screen modal** (`ImagePreviewModal`) with a Download
 *      button. This is how you actually save a generated/segmented image to
 *      disk at full quality — Export saves to the *Library*, not your
 *      computer.
 *   2. **Right-click → context menu** (`ImageContextMenu`) with Download PNG
 *      / Open in new tab.
 *   3. **Checkerboard** (opt-in) so transparent PNGs (SAM 3 cutout, Image
 *      Stack / Transform output) read as transparent, not invisible.
 *
 * Built on `MediaPreviewImage` so it inherits the "silhouette is sacred"
 * aspect-ratio contract. Use this instead of a raw `<img>` for any node
 * that shows a single result image.
 */
export interface PreviewImageProps {
  /** Image URL to render. */
  url: string;
  /** Accessible alt text + default download filename base. */
  alt?: string;
  /** Filename (sans extension) for downloads. Defaults to `alt`. */
  downloadName?: string;
  /** CSS aspect-ratio string forwarded to `MediaPreviewImage`. */
  aspectRatio?: string | null;
  /** `"contain"` (default) letterboxes; `"cover"` fills + crops. */
  fit?: "contain" | "cover";
  /** Paint a transparency checkerboard behind the image + in the modal. */
  checkerboard?: boolean;
  /** Extra classes on the clickable wrapper. */
  className?: string;
  /** `data-testid` on the clickable wrapper. */
  testId?: string;
}

export function PreviewImage({
  url,
  alt,
  downloadName,
  aspectRatio,
  fit = "contain",
  checkerboard = false,
  className,
  testId,
}: PreviewImageProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ImageContextMenu url={url} downloadName={downloadName ?? alt}>
        <button
          type="button"
          aria-label={alt ? `Preview ${alt}` : "Preview image"}
          // Don't let the click/drag reach React Flow (pan/select).
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setOpen(true)}
          className={cn(
            "group relative block w-full cursor-zoom-in overflow-hidden rounded-md",
            className,
          )}
        >
          <MediaPreviewImage
            url={url}
            alt={alt}
            aspectRatio={aspectRatio}
            fit={fit}
            checkerboard={checkerboard}
            // Click is owned by this button (→ modal); suppress the
            // new-tab anchor so it doesn't hijack the gesture.
            href={null}
            // Carry the testId on the aspect-bearing wrapper so callers
            // asserting `style.aspectRatio` on it keep working.
            testId={testId}
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-[11px] font-medium text-transparent transition-colors group-hover:bg-black/30 group-hover:text-white">
            Click to preview
          </span>
        </button>
      </ImageContextMenu>
      {open ? (
        <ImagePreviewModal
          url={url}
          alt={alt}
          downloadName={downloadName ?? alt}
          checkerboard={checkerboard}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
