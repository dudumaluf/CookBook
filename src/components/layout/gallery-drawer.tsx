"use client";

import {
  Download,
  Loader2,
  Pin,
  RefreshCcw,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GalleryLightbox } from "./gallery-lightbox";
import {
  downloadFromUrl,
  downloadText,
  safeFilename,
} from "@/lib/library/download";
import {
  GENERATION_DRAG_MIME,
  serializeGenerationDrag,
  type GenerationDragItem,
} from "@/lib/library/generation-drag";
import { useGenerations } from "@/lib/hooks/use-generations";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";
import type {
  GenerationFilter,
  GenerationOutputType,
  GenerationRecord,
} from "@/lib/repositories/generation-repository";
import type { StandardizedOutput } from "@/types/node";

/**
 * GalleryDrawer (Slice 6.5 — content-management surface).
 *
 * Bottom-drawer overlay (~65vh) that lists every persisted generation
 * for the active project. UX hits:
 *
 *  - **Filter chips**: All / Image / Text / Video / Pinned. Active chip
 *    accents.
 *  - **Search** — case-insensitive substring on `prompt_text`.
 *  - **Multi-select**: plain-click selects + clears others; cmd/ctrl
 *    toggles; shift extends from anchor to clicked card.
 *  - **Bulk action bar** — appears when ≥1 selected; offers Pin,
 *    Download (sequential), Delete.
 *  - **Card click** opens the GalleryLightbox; arrow keys cycle.
 *  - **Drag** — single card or multi-selection drags as one
 *    `application/x-cookbook-generation` payload onto canvas
 *    (canvas-flow.tsx onDrop spawns image/text nodes).
 */

const FILTER_TABS: ReadonlyArray<{
  id: "all" | "image" | "text" | "video" | "pinned";
  label: string;
  outputType?: GenerationOutputType;
  pinnedOnly?: boolean;
}> = [
  { id: "all", label: "All" },
  { id: "image", label: "Image", outputType: "image" },
  { id: "text", label: "Text", outputType: "text" },
  { id: "video", label: "Video", outputType: "video" },
  { id: "pinned", label: "Pinned", pinnedOnly: true },
];

type TabId = (typeof FILTER_TABS)[number]["id"];

function pickFirst(
  output: GenerationRecord["output"],
): StandardizedOutput | null {
  if (Array.isArray(output)) return output[0] ?? null;
  return output ?? null;
}

function displayTitle(row: GenerationRecord): string {
  return row.title ?? row.promptText ?? row.nodeKind;
}

export function GalleryDrawer() {
  const { galleryOpen, setGalleryOpen } = useLayoutStore();
  const projectId = useProjectStore((s) => s.id);
  const [tab, setTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [busyBulk, setBusyBulk] = useState(false);
  // Track active drag-from-card so we can let pointer events pass through
  // to the canvas underneath WITHOUT unmounting the drawer (which would
  // abort the drag — browsers cancel a drag whose source element leaves
  // the DOM mid-gesture, the bug behind "drawer closes on mousedown").
  const [isDragging, setIsDragging] = useState(false);

  const filter = useMemo<GenerationFilter | null>(() => {
    if (!projectId) return null;
    const cfg = FILTER_TABS.find((t) => t.id === tab)!;
    return {
      projectId,
      promptContains: search.trim() || undefined,
      outputType: cfg.outputType,
      pinnedOnly: cfg.pinnedOnly,
      limit: 200,
    };
  }, [projectId, tab, search]);

  const { data, isLoading, error, refresh } = useGenerations(filter);

  // Re-fetch when the user opens the drawer (catch up to anything that
  // landed since last open).
  useEffect(() => {
    if (galleryOpen) void refresh();
  }, [galleryOpen, refresh]);

  // Drop selection / lightbox state when the filter changes the visible
  // set out from under us. (Drawer-local concern; the lint rule's
  // "no setState in effect" doesn't fit here because `tab` / `search`
  // are dependencies on which we deliberately reset adjacent state.)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setSelectedIds(new Set());
    setAnchorId(null);
  }, [tab, search]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Trap Esc to close drawer (lightbox owns its own Esc handler).
  useEffect(() => {
    if (!galleryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !lightboxId) setGalleryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [galleryOpen, lightboxId, setGalleryOpen]);

  const selectedRecords = useMemo(
    () => data.filter((r) => selectedIds.has(r.id)),
    [data, selectedIds],
  );

  /* ──────────── Selection ──────────── */

  const handleCardClick = useCallback(
    (id: string, event: React.MouseEvent) => {
      const isMulti = event.metaKey || event.ctrlKey;
      const isRange = event.shiftKey;
      if (isRange && anchorId) {
        const ids = data.map((r) => r.id);
        const a = ids.indexOf(anchorId);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          setSelectedIds(new Set(ids.slice(lo, hi + 1)));
        }
        return;
      }
      if (isMulti) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setAnchorId(id);
        return;
      }
      // Plain click — open lightbox. (Selection clears so Bulk Bar
      // doesn't linger; user clicked something specific.)
      setSelectedIds(new Set());
      setAnchorId(id);
      setLightboxId(id);
    },
    [data, anchorId],
  );

  /* ──────────── Bulk actions ──────────── */

  async function bulkPin(target: boolean) {
    setBusyBulk(true);
    try {
      const repo = getGenerationRepository();
      await Promise.allSettled(
        selectedRecords.map((r) => repo.setPinned(r.id, target)),
      );
      await refresh();
      toast.success(
        target
          ? `Pinned ${selectedRecords.length}`
          : `Unpinned ${selectedRecords.length}`,
      );
    } finally {
      setBusyBulk(false);
    }
  }

  async function bulkDelete() {
    if (
      !window.confirm(
        `Delete ${selectedRecords.length} generation${selectedRecords.length === 1 ? "" : "s"}? This can't be undone.`,
      )
    )
      return;
    setBusyBulk(true);
    try {
      const repo = getGenerationRepository();
      await Promise.allSettled(
        selectedRecords.map((r) => repo.remove(r.id)),
      );
      setSelectedIds(new Set());
      setAnchorId(null);
      await refresh();
      toast.success(`Deleted ${selectedRecords.length}`);
    } finally {
      setBusyBulk(false);
    }
  }

  async function bulkDownload() {
    // Cross-origin URLs (Supabase Storage) ignore the anchor `download`
    // attribute, so we fetch each one as a Blob and trigger the
    // download against a same-origin blob URL. Sequential with a small
    // gap so the browser doesn't collapse them.
    for (const row of selectedRecords) {
      const out = pickFirst(row.output);
      if (!out) continue;
      const filenameBase =
        row.title ?? row.promptText?.slice(0, 60) ?? row.nodeKind;
      const safe = safeFilename(filenameBase);
      try {
        if (out.type === "image" && out.value?.url) {
          await downloadFromUrl(out.value.url, `${safe}.png`);
        } else if (out.type === "video" && out.value?.url) {
          await downloadFromUrl(out.value.url, `${safe}.mp4`);
        } else if (out.type === "audio" && out.value?.url) {
          await downloadFromUrl(out.value.url, `${safe}.wav`);
        } else if (out.type === "text" && typeof out.value === "string") {
          downloadText(out.value, `${safe}.txt`);
        }
      } catch (err) {
        console.warn("[gallery] download failed:", err);
        toast.error(`Could not download ${safe}`);
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  // Compute counts before the conditional return so the hook order is
  // stable across renders (rules-of-hooks).
  const counts = useMemoCountsForCounters(data);

  if (!galleryOpen) return null;

  return (
    <>
      <div
        // Why both this wrapper AND the backdrop need pointer-events-none
        // during drag:
        //
        // The drawer is `fixed inset-0 z-50`, so its OUTER wrapper covers
        // the whole viewport — it sits above the React Flow canvas in the
        // stacking order. CSS hit-testing walks front-to-back; with only
        // the backdrop set to pointer-events-none, the next hit-target is
        // the wrapper itself (still pointer-events-auto by default), which
        // has no drag handler and silently rejects the drop. The card
        // "snaps back" because the drop never reached the canvas.
        //
        // Setting pointer-events-none on the wrapper too makes it
        // transparent to events, so the canvas underneath catches them.
        // Crucially, pointer-events is NOT a CSS inherited property —
        // children with `auto` (default) keep their own interactivity
        // independently. Section + cards stay fully interactive, drag
        // source survives, drop reaches the canvas above the drawer.
        className={`fixed inset-0 z-50 flex flex-col items-stretch ${
          isDragging ? "pointer-events-none" : ""
        }`}
      >
        <button
          type="button"
          aria-label="Close gallery"
          onClick={() => setGalleryOpen(false)}
          className={`flex-1 cursor-default bg-background/60 backdrop-blur-sm ${
            isDragging ? "pointer-events-none" : ""
          }`}
        />
        <section
          aria-label="Gallery"
          className="flex h-[65vh] flex-col rounded-t-3xl border-t border-border/80 bg-popover/95 shadow-2xl shadow-black/60 backdrop-blur-md"
        >
          <header className="flex flex-col gap-2.5 border-b border-border/60 px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-1 w-10 rounded-full bg-border"
                  aria-hidden
                />
                <h2 className="text-sm font-medium text-foreground">
                  Gallery
                </h2>
                <span
                  data-testid="gallery-count"
                  className="text-xs text-muted-foreground"
                >
                  {data.length} {data.length === 1 ? "item" : "items"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="flex items-center gap-1 rounded-full border border-border/80 bg-background px-2">
                  <Search className="h-3.5 w-3.5" aria-hidden />
                  <Input
                    placeholder="Search prompts…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-7 w-48 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
                  />
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Refresh"
                      data-testid="gallery-refresh"
                      onClick={() => void refresh()}
                      className="h-7 w-7 rounded-full"
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Close gallery"
                      onClick={() => setGalleryOpen(false)}
                      className="h-7 w-7 rounded-full"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Close (Esc)</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Filter chips */}
            <div
              role="tablist"
              aria-label="Gallery filters"
              data-testid="gallery-filter-chips"
              className="flex items-center gap-1 text-xs"
            >
              {FILTER_TABS.map((t) => {
                const isActive = tab === t.id;
                const count =
                  t.id === "all"
                    ? counts.all
                    : t.id === "image"
                      ? counts.image
                      : t.id === "text"
                        ? counts.text
                        : t.id === "video"
                          ? counts.video
                          : counts.pinned;
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={isActive}
                    data-testid={`gallery-tab-${t.id}`}
                    onClick={() => setTab(t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 transition-colors ${
                      isActive
                        ? "border-accent/60 bg-accent/15 text-foreground"
                        : "border-border/60 bg-background/40 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.id === "pinned" ? (
                      <Star
                        className={`h-3 w-3 ${isActive ? "fill-current" : ""}`}
                      />
                    ) : null}
                    <span>{t.label}</span>
                    <span className="text-[10px] text-muted-foreground/70">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </header>

          {/* Bulk action bar — appears when N selected */}
          {selectedIds.size > 0 ? (
            <div
              data-testid="gallery-bulk-bar"
              className="flex items-center justify-between gap-3 border-b border-border/40 bg-accent/5 px-5 py-2 text-xs"
            >
              <span className="text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  disabled={busyBulk}
                  onClick={() => void bulkPin(true)}
                >
                  <Pin className="h-3 w-3" />
                  Pin
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  disabled={busyBulk}
                  onClick={() => void bulkPin(false)}
                >
                  Unpin
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  disabled={busyBulk}
                  onClick={() => void bulkDownload()}
                >
                  <Download className="h-3 w-3" />
                  Download
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-[11px] text-destructive hover:bg-destructive/10"
                  disabled={busyBulk}
                  onClick={() => void bulkDelete()}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-muted-foreground"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </Button>
              </div>
            </div>
          ) : null}

          {isLoading && data.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
            </div>
          ) : error ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-destructive">
                Failed to load: {error.message}
              </p>
            </div>
          ) : data.length === 0 ? (
            <EmptyState tab={tab} hasSearch={search.length > 0} />
          ) : (
            <div className="grid flex-1 auto-rows-[180px] grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 overflow-y-auto p-4">
              {data.map((row) => (
                <GenerationCard
                  key={row.id}
                  row={row}
                  selected={selectedIds.has(row.id)}
                  selectedRecords={selectedRecords}
                  onClick={(e) => handleCardClick(row.id, e)}
                  onChanged={() => void refresh()}
                  onDragStartCommit={() => setIsDragging(true)}
                  onDragEndCommit={(succeeded) => {
                    setIsDragging(false);
                    // Drop landed on a real target (e.g. canvas) —
                    // close the drawer so the user sees their newly
                    // spawned node. If they cancelled the drag (Esc /
                    // dropped on backdrop), keep the drawer open.
                    if (succeeded) setGalleryOpen(false);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {lightboxId ? (
        <GalleryLightbox
          items={data}
          activeId={lightboxId}
          onClose={() => setLightboxId(null)}
          onActiveChange={(id) => setLightboxId(id)}
          onChanged={() => void refresh()}
        />
      ) : null}
    </>
  );
}

// Hook avoidance — local mini hook keeps the counts derivation tidy.
function useMemoCountsForCounters(data: GenerationRecord[]) {
  return useMemo(() => {
    const counts = { all: 0, image: 0, text: 0, video: 0, pinned: 0 };
    for (const r of data) {
      counts.all++;
      const out = pickFirst(r.output);
      if (out?.type === "image") counts.image++;
      else if (out?.type === "text") counts.text++;
      else if (out?.type === "video") counts.video++;
      if (r.pinned) counts.pinned++;
    }
    return counts;
  }, [data]);
}

function EmptyState({ tab, hasSearch }: { tab: TabId; hasSearch: boolean }) {
  const heading =
    tab === "pinned"
      ? "No pinned items"
      : hasSearch
        ? "No matches"
        : tab === "all"
          ? "No results yet"
          : `No ${tab} generations yet`;
  const body =
    tab === "pinned"
      ? "Pin a generation to keep it here."
      : hasSearch
        ? "Try a different search term."
        : "Once you run a recipe, every image and text result lands here automatically.";
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <p className="text-sm font-medium text-foreground">{heading}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function GenerationCard({
  row,
  selected,
  selectedRecords,
  onClick,
  onChanged,
  onDragStartCommit,
  onDragEndCommit,
}: {
  row: GenerationRecord;
  selected: boolean;
  selectedRecords: GenerationRecord[];
  onClick: (e: React.MouseEvent) => void;
  onChanged: () => void;
  onDragStartCommit: () => void;
  onDragEndCommit: (succeeded: boolean) => void;
}) {
  const single = pickFirst(row.output);
  return (
    <div
      data-testid="gallery-card"
      data-pinned={row.pinned}
      data-selected={selected}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
      // Drag the card (or the whole multi-selection) onto canvas.
      draggable
      onDragStart={(e) => {
        if (!single) return;
        const items: GenerationDragItem[] =
          selectedRecords.length > 1 && selected
            ? selectedRecords
                .map((r) => ({
                  generationId: r.id,
                  output: pickFirst(r.output)!,
                }))
                .filter((i) => i.output)
            : [{ generationId: row.id, output: single }];
        e.dataTransfer.setData(
          GENERATION_DRAG_MIME,
          serializeGenerationDrag({ items }),
        );
        e.dataTransfer.effectAllowed = "copy";
        // Defer the parent's pointer-events-none flip to the next frame.
        // Mutating the source's ancestor (pointer-events / opacity / DOM
        // structure) inside the same tick as `dragstart` makes some
        // browsers cancel the drag before it fully commits — that's
        // why "drag started but never moved" was happening. By the time
        // rAF fires, the OS-level drag is firmly in flight and CSS
        // changes are safe.
        requestAnimationFrame(() => onDragStartCommit());
      }}
      onDragEnd={(e) => {
        // dropEffect tells us whether a drop target accepted the drag.
        // "copy"/"move"/"link" = accepted (canvas spawned a node).
        // "none" = cancelled (Esc, dropped over a non-target). Some
        // browsers always report "none" — that's fine; the drawer
        // simply stays open and the user keeps going.
        onDragEndCommit(e.dataTransfer.dropEffect !== "none");
      }}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-card/60 transition-all ${
        selected
          ? "border-accent/80 ring-2 ring-accent/40"
          : "border-border/60 hover:border-border"
      }`}
    >
      <div className="relative flex-1 overflow-hidden bg-foreground/5">
        <CardThumb output={single} />
        <button
          type="button"
          aria-label={row.pinned ? "Unpin" : "Pin"}
          onClick={async (e) => {
            e.stopPropagation();
            try {
              await getGenerationRepository().setPinned(row.id, !row.pinned);
              onChanged();
            } catch (err) {
              console.warn("[gallery] pin failed:", err);
            }
          }}
          className={`absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full backdrop-blur transition-colors ${
            row.pinned
              ? "bg-amber-500/30 text-amber-100"
              : "bg-background/70 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
          }`}
        >
          <Pin className={`h-3 w-3 ${row.pinned ? "fill-current" : ""}`} />
        </button>
      </div>
      <div className="border-t border-border/40 bg-popover/40 px-2 py-1">
        <p className="truncate text-[11px] text-foreground/85" title={displayTitle(row)}>
          {displayTitle(row)}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
          {row.nodeKind}
        </p>
      </div>
    </div>
  );
}

function CardThumb({ output }: { output: StandardizedOutput | null }) {
  if (!output) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
        —
      </div>
    );
  }
  if (output.type === "image" && output.value.url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={output.value.url}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
        onError={(e) => {
          (e.target as HTMLImageElement).style.opacity = "0";
        }}
      />
    );
  }
  if (output.type === "video" && output.value.url) {
    return (
      <video
        src={output.value.url}
        className="h-full w-full object-cover"
        muted
        loop
        playsInline
        preload="metadata"
        onMouseEnter={(e) => void (e.currentTarget as HTMLVideoElement).play()}
        onMouseLeave={(e) => {
          const v = e.currentTarget as HTMLVideoElement;
          v.pause();
          v.currentTime = 0;
        }}
      />
    );
  }
  if (output.type === "audio" && output.value.url) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-foreground/[0.03] p-2">
        <audio
          src={output.value.url}
          controls
          preload="metadata"
          className="w-full"
          onPointerDown={(e) => e.stopPropagation()}
        />
      </div>
    );
  }
  if (output.type === "text") {
    return (
      <div className="flex h-full w-full items-start overflow-hidden p-2">
        <p className="line-clamp-6 text-[10.5px] leading-relaxed text-foreground/80">
          {output.value}
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-[10.5px] text-muted-foreground">
      {output.type}
    </div>
  );
}
