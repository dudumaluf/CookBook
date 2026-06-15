"use client";

import { Download, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { downloadFromUrl, safeFilename } from "@/lib/library/download";

/**
 * ImagePreviewModal — Slice 7.10.
 *
 * Full-screen, gallery-style preview for a single image rendered inside a
 * node body (Image Grid, Frames Extract, …). The Gallery's lightbox is
 * coupled to `GenerationRecord` (pin / delete / repository), so this is a
 * deliberately small, dependency-free sibling for "I just want to see this
 * one image big" moments.
 *
 * Why a portal: nodes live inside React Flow's CSS-transformed viewport.
 * A `position: fixed` element rendered *inside* a transformed ancestor is
 * positioned relative to that ancestor, not the screen — the overlay would
 * be clipped / offset. `createPortal(..., document.body)` escapes the
 * transform entirely so the overlay covers the real viewport. It also puts
 * the overlay outside React Flow's event surface, so clicks here never
 * select / drag the underlying node.
 *
 * Close affordances mirror the Gallery lightbox: Esc, backdrop click, and
 * the X button. The image itself swallows clicks so a mis-aimed click on
 * the picture doesn't dismiss the modal.
 */

interface ImagePreviewModalProps {
  /** Image URL to preview. */
  url: string;
  /** Accessible alt + download filename base. */
  alt?: string;
  /** Filename (sans extension) for the download button. Defaults to `alt`. */
  downloadName?: string;
  onClose: () => void;
}

export function ImagePreviewModal({
  url,
  alt,
  downloadName,
  onClose,
}: ImagePreviewModalProps) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const download = useCallback(async () => {
    setBusy(true);
    try {
      const base = safeFilename(downloadName ?? alt ?? "image");
      await downloadFromUrl(url, `${base}.png`);
    } catch (err) {
      console.warn("[image-preview] download failed:", err);
      toast.error("Could not download image");
    } finally {
      setBusy(false);
    }
  }, [url, alt, downloadName]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt ? `${alt} preview` : "Image preview"}
      data-testid="image-preview-modal"
      onClick={onClose}
      // Stop pointer events from reaching React Flow underneath (pan/select).
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-background/95 p-6 backdrop-blur-md"
    >
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <button
          type="button"
          aria-label="Download"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void download();
          }}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-popover/80 text-foreground shadow-md backdrop-blur transition-colors hover:bg-popover disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Close preview"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-popover/80 text-foreground shadow-md backdrop-blur transition-colors hover:bg-popover"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt ?? ""}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] object-contain"
        draggable={false}
      />
    </div>,
    document.body,
  );
}
