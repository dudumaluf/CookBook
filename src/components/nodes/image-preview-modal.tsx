"use client";

import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { CHECKERBOARD_STYLE } from "@/components/nodes/media-preview";
import { downloadFromUrl, safeFilename } from "@/lib/library/download";

/**
 * ImagePreviewModal — Slice 7.10 (+ batch navigation).
 *
 * Full-screen, gallery-style preview for an image rendered inside a
 * node body (Image Grid, Fal Image batch, Frames Extract, …). The
 * Gallery's lightbox is coupled to `GenerationRecord` (pin / delete /
 * repository), so this is a deliberately small, dependency-free sibling
 * for "I just want to see this one big" moments.
 *
 * Two shapes, one component:
 *   - **Single** — pass `url` (+ `alt` / `downloadName` / `checkerboard`).
 *     Exactly the original behaviour.
 *   - **Batch** — pass `items` (+ optional starting `index` and
 *     `onIndexChange`). The modal renders `items[index]` and lets you walk
 *     the whole set WITHOUT leaving the modal: ‹ › buttons, ← / → keys
 *     (wrap-around), and a `n / N` counter. `onIndexChange` fires on every
 *     move so the calling node can keep its own cursor in sync — close the
 *     modal and the node body is already focused on the last image you saw.
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
 * the X button. The image + the nav chrome swallow clicks so a mis-aimed
 * click there doesn't dismiss the modal.
 */

export interface PreviewModalItem {
  /** Image URL to preview. */
  url: string;
  /** Accessible alt + default download filename base. */
  alt?: string;
  /** Filename (sans extension) for the download button. Defaults to `alt`. */
  downloadName?: string;
  /** Paint a transparency checkerboard behind this item. */
  checkerboard?: boolean;
}

interface ImagePreviewModalProps {
  /** Single-item URL. Used when `items` is not provided. */
  url?: string;
  /** Single-item alt + download filename base. */
  alt?: string;
  /** Single-item download filename (sans extension). Defaults to `alt`. */
  downloadName?: string;
  /**
   * Paint a checkerboard directly behind the picture so a transparent PNG
   * (SAM 3 cutout, Image Stack / Transform output) is legible instead of
   * vanishing into the dark backdrop. Single-item only; batch items carry
   * their own `checkerboard`. Default false.
   */
  checkerboard?: boolean;
  /**
   * Batch of images to page through. When present (and length > 1) the
   * modal shows prev/next arrows + ← / → key navigation + an `n / N`
   * counter. A single-item array behaves like the `url` form.
   */
  items?: PreviewModalItem[];
  /** Starting index into `items`. Clamped to range. Default 0. */
  index?: number;
  /**
   * Fired whenever the visible item changes (arrow / key). Lets the parent
   * node sync its own preview cursor so closing the modal lands on the
   * last-viewed image.
   */
  onIndexChange?: (next: number) => void;
  onClose: () => void;
}

export function ImagePreviewModal({
  url,
  alt,
  downloadName,
  checkerboard = false,
  items,
  index = 0,
  onIndexChange,
  onClose,
}: ImagePreviewModalProps) {
  const [busy, setBusy] = useState(false);

  // Normalise both shapes to a single list so the render path is uniform.
  const list = useMemo<PreviewModalItem[]>(
    () =>
      items && items.length > 0
        ? items
        : [{ url: url ?? "", alt, downloadName, checkerboard }],
    [items, url, alt, downloadName, checkerboard],
  );
  const count = list.length;

  // The modal OWNS the cursor while open (seeded from `index`); it only
  // *notifies* the parent via `onIndexChange`. This avoids a controlled/
  // uncontrolled tug-of-war when the parent re-renders the thumbnail behind
  // the open modal in response to that very notification.
  const [cursor, setCursor] = useState(() =>
    Math.min(Math.max(0, Math.trunc(index)), count - 1),
  );
  const safeCursor = Math.min(Math.max(0, cursor), count - 1);
  const current = list[safeCursor]!;

  // Latest values in refs so the keydown listener can subscribe ONCE
  // (stable deps) without going stale. Synced in an effect — never assigned
  // during render (React Compiler: refs are not render inputs).
  const countRef = useRef(count);
  const onCloseRef = useRef(onClose);
  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    countRef.current = count;
    onCloseRef.current = onClose;
    onIndexChangeRef.current = onIndexChange;
  });

  const go = useCallback((delta: number) => {
    setCursor((c) => {
      const n = countRef.current;
      if (n <= 1) return c;
      const next = (((c + delta) % n) + n) % n; // wrap both directions
      onIndexChangeRef.current?.(next);
      return next;
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (countRef.current <= 1) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const download = useCallback(async () => {
    setBusy(true);
    try {
      const base = safeFilename(
        current.downloadName ?? current.alt ?? "image",
      );
      await downloadFromUrl(current.url, `${base}.png`);
    } catch (err) {
      console.warn("[image-preview] download failed:", err);
      toast.error("Could not download image");
    } finally {
      setBusy(false);
    }
  }, [current.url, current.alt, current.downloadName]);

  if (typeof document === "undefined") return null;

  const navigable = count > 1;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.alt ? `${current.alt} preview` : "Image preview"}
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

      {navigable ? (
        <button
          type="button"
          aria-label="Previous image"
          data-testid="image-preview-prev"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          className="absolute left-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-popover/80 text-foreground shadow-md backdrop-blur transition-colors hover:bg-popover"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      ) : null}

      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] max-w-[90vw] overflow-hidden rounded-md shadow-2xl"
        style={current.checkerboard ? CHECKERBOARD_STYLE : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.alt ?? ""}
          className="max-h-[90vh] max-w-[90vw] object-contain"
          draggable={false}
        />
      </div>

      {navigable ? (
        <>
          <button
            type="button"
            aria-label="Next image"
            data-testid="image-preview-next"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-4 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-popover/80 text-foreground shadow-md backdrop-blur transition-colors hover:bg-popover"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div
            data-testid="image-preview-counter"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-5 left-1/2 -translate-x-1/2 select-none rounded-full bg-popover/80 px-2.5 py-1 font-mono text-xs text-foreground shadow-md backdrop-blur"
          >
            {safeCursor + 1} / {count}
          </div>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
