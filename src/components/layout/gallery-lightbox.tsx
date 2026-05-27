"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  Pin,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InlineRename } from "@/components/library/inline-rename";
import {
  GENERATION_DRAG_MIME,
  serializeGenerationDrag,
} from "@/lib/library/generation-drag";
import type { GenerationRecord } from "@/lib/repositories/generation-repository";
import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";
import type { StandardizedOutput } from "@/types/node";

/**
 * GalleryLightbox — Slice 6.5 (ADR-0038).
 *
 * Full-screen modal for previewing one generation at a time. Opens when
 * a Gallery card is clicked. Inside:
 *
 *  - **Preview** (image / text). Image is `object-contain` so aspect
 *    ratio is honored. Text is centered, scrollable, max-width.
 *  - **Inline rename** at the top — sets `title` via the repository.
 *  - **Footer actions**: Pin / Download / Delete. Use-in-workflow is
 *    expressed via dragging the lightbox preview to canvas (same MIME
 *    as the cards) so we don't multiply close-then-drop choreography.
 *  - **Keyboard nav**: ArrowLeft / ArrowRight cycle through the
 *    parent's pre-filtered list (`items`); Esc closes; Enter starts
 *    rename.
 *  - **Hover side-arrow buttons** for mouse users.
 *
 * Items are passed in by the parent so navigation is "list-aware":
 * the user can step through the current filter view (Image only,
 * Pinned only, etc.) without losing context.
 */

interface GalleryLightboxProps {
  /** All items currently in the parent's filtered view, newest-first. */
  items: GenerationRecord[];
  /** The id of the currently shown item — controls navigation cursor. */
  activeId: string | null;
  onClose: () => void;
  onActiveChange: (id: string) => void;
  /** Called after destructive / mutating ops so the parent can refresh. */
  onChanged: () => void;
}

function getActive(
  items: GenerationRecord[],
  activeId: string | null,
): { record: GenerationRecord | null; index: number } {
  if (!activeId) return { record: null, index: -1 };
  const index = items.findIndex((r) => r.id === activeId);
  return { record: index >= 0 ? items[index]! : null, index };
}

function pickFirst(
  output: GenerationRecord["output"],
): StandardizedOutput | null {
  if (Array.isArray(output)) return output[0] ?? null;
  return output ?? null;
}

function displayTitle(row: GenerationRecord): string {
  return row.title ?? row.promptText ?? row.nodeKind;
}

async function downloadOutput(
  row: GenerationRecord,
  out: StandardizedOutput | null,
): Promise<void> {
  if (!out) return;
  const filenameBase =
    row.title ?? row.promptText?.slice(0, 60) ?? row.nodeKind;
  const safe = filenameBase
    .replace(/[^a-zA-Z0-9._\- ]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 96);
  if (out.type === "image" && out.value?.url) {
    // Browser-native: anchor with download attribute. Cross-origin URLs
    // (Supabase Storage) honor `download` because we set the bucket as
    // public; the file lands in Downloads.
    const a = document.createElement("a");
    a.href = out.value.url;
    a.download = `${safe}.png`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  if (out.type === "text" && typeof out.value === "string") {
    const blob = new Blob([out.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }
}

export function GalleryLightbox({
  items,
  activeId,
  onClose,
  onActiveChange,
  onChanged,
}: GalleryLightboxProps) {
  const { record, index } = getActive(items, activeId);
  const renameRef = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);

  const goPrev = useCallback(() => {
    if (items.length === 0 || index <= 0) return;
    onActiveChange(items[index - 1]!.id);
  }, [items, index, onActiveChange]);

  const goNext = useCallback(() => {
    if (items.length === 0 || index < 0 || index >= items.length - 1) return;
    onActiveChange(items[index + 1]!.id);
  }, [items, index, onActiveChange]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Don't intercept arrows while the inline rename input has focus.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, onClose]);

  if (!record) return null;
  const out = pickFirst(record.output);

  async function togglePin() {
    if (!record) return;
    setBusy(true);
    try {
      await getGenerationRepository().setPinned(record.id, !record.pinned);
      onChanged();
    } catch (err) {
      console.warn("[lightbox] pin failed:", err);
      toast.error("Could not update pin");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!record) return;
    setBusy(true);
    try {
      await getGenerationRepository().remove(record.id);
      // Move to the next item if there is one, else close.
      if (items.length > 1) {
        const nextIdx = Math.min(index + 1, items.length - 2);
        onActiveChange(items[Math.max(nextIdx, 0)]!.id);
      } else {
        onClose();
      }
      onChanged();
      toast.success("Generation deleted");
    } catch (err) {
      console.warn("[lightbox] delete failed:", err);
      toast.error("Could not delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Generation preview"
      data-testid="gallery-lightbox"
      className="fixed inset-0 z-[60] flex flex-col bg-background/95 backdrop-blur-md"
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-border/40 px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {out?.type ?? record.nodeKind}
          </span>
          <InlineRename
            value={displayTitle(record)}
            ariaLabel={`Rename ${displayTitle(record)}`}
            onCommit={async (next) => {
              try {
                await getGenerationRepository().setTitle(record.id, next);
                onChanged();
              } catch (err) {
                console.warn("[lightbox] rename failed:", err);
                toast.error("Could not rename");
              }
            }}
            startEditingRef={renameRef}
            renderLabel={({ startEditing }) => (
              <button
                type="button"
                onDoubleClick={startEditing}
                className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:text-foreground/80"
                title="Double-click to rename"
              >
                {displayTitle(record)}
              </button>
            )}
            inputClassName="min-w-0 flex-1 rounded-md bg-background/70 px-2 py-1 text-sm text-foreground outline-none ring-1 ring-accent/60"
          />
          <span className="shrink-0 text-[11px] text-muted-foreground/70">
            {index + 1} / {items.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={record.pinned ? "Unpin" : "Pin"}
                onClick={togglePin}
                disabled={busy}
                className={`h-8 w-8 rounded-full ${
                  record.pinned
                    ? "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                    : ""
                }`}
              >
                <Pin
                  className={`h-3.5 w-3.5 ${record.pinned ? "fill-current" : ""}`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {record.pinned ? "Unpin" : "Pin"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Download"
                onClick={() => downloadOutput(record, out)}
                disabled={busy}
                className="h-8 w-8 rounded-full"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete"
                onClick={remove}
                disabled={busy}
                className="h-8 w-8 rounded-full text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close preview"
                onClick={onClose}
                className="h-8 w-8 rounded-full"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Body — preview with side-nav arrows */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
        {index > 0 ? (
          <button
            type="button"
            aria-label="Previous"
            onClick={goPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-popover/80 text-foreground shadow-md backdrop-blur transition-colors hover:bg-popover"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}
        {index >= 0 && index < items.length - 1 ? (
          <button
            type="button"
            aria-label="Next"
            onClick={goNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-popover/80 text-foreground shadow-md backdrop-blur transition-colors hover:bg-popover"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        ) : null}

        <div
          // Drag the preview onto canvas — same MIME / payload as cards.
          draggable
          onDragStart={(e) => {
            if (!out) return;
            e.dataTransfer.setData(
              GENERATION_DRAG_MIME,
              serializeGenerationDrag({
                items: [{ generationId: record.id, output: out }],
              }),
            );
            e.dataTransfer.effectAllowed = "copy";
          }}
          className="flex max-h-full max-w-full cursor-grab items-center justify-center active:cursor-grabbing"
        >
          {out?.type === "image" && out.value?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={out.value.url}
              alt={displayTitle(record)}
              className="max-h-[85vh] max-w-[90vw] object-contain"
              draggable={false}
            />
          ) : out?.type === "text" ? (
            <div className="nowheel max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border/40 bg-popover/50 p-6">
              <p className="select-text whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                {String(out.value)}
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-foreground/5 p-12 text-sm text-muted-foreground">
              {out?.type ?? "—"}
            </div>
          )}
        </div>
      </div>

      {/* Footer — meta info */}
      {record.promptText || record.usage ? (
        <footer className="flex items-center justify-between gap-3 border-t border-border/40 px-5 py-2 text-[11px] text-muted-foreground">
          <p className="truncate" title={record.promptText ?? ""}>
            {record.promptText ?? ""}
          </p>
          {record.usage?.costUsd !== undefined ? (
            <span className="shrink-0">
              ${record.usage.costUsd.toFixed(4)}
            </span>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
