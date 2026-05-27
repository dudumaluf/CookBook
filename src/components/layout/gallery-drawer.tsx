"use client";

import {
  Loader2,
  Pin,
  RefreshCcw,
  Search,
  Star,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGenerations } from "@/lib/hooks/use-generations";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { getGenerationRepository } from "@/lib/repositories/supabase-generation-repository";
import type { GenerationRecord } from "@/lib/repositories/generation-repository";
import type { StandardizedOutput } from "@/types/node";

/**
 * GalleryDrawer (Slice 6.2 — wired).
 *
 * Bottom-drawer overlay that takes ~65% of viewport height with a dimmed
 * backdrop. Subscribes to `cookbook_generations` for the current project
 * and renders a grid of generated outputs (images + text). Filters:
 *   - Search by prompt_text (case-insensitive substring).
 *   - "Pinned only" toggle.
 *
 * Per-row affordances:
 *   - Pin / unpin (yellow star).
 *   - Click → expands inline preview (text full / image full-width).
 *
 * Empty state when project hasn't generated anything yet.
 *
 * Refresh: manual button. Slice 6.4 will move to realtime via Supabase
 * subscriptions; today the drawer refetches on open + on filter change.
 */
export function GalleryDrawer() {
  const { galleryOpen, setGalleryOpen } = useLayoutStore();
  const projectId = useProjectStore((s) => s.id);
  const [search, setSearch] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);

  const filter = useMemo(
    () =>
      projectId
        ? {
            projectId,
            promptContains: search.trim() || undefined,
            pinnedOnly: pinnedOnly || undefined,
            limit: 200,
          }
        : null,
    [projectId, search, pinnedOnly],
  );

  const { data, isLoading, error, refresh } = useGenerations(filter);

  // Re-fetch when the user opens the drawer (catch up to anything that
  // landed since last open).
  useEffect(() => {
    if (galleryOpen) void refresh();
  }, [galleryOpen, refresh]);

  // Trap Esc to close (closeAllOverlays handles this globally too;
  // belt-and-suspenders for keyboard inside the drawer).
  useEffect(() => {
    if (!galleryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGalleryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [galleryOpen, setGalleryOpen]);

  if (!galleryOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-stretch">
      <button
        type="button"
        aria-label="Close gallery"
        onClick={() => setGalleryOpen(false)}
        className="flex-1 cursor-default bg-background/60 backdrop-blur-sm"
      />
      <section
        aria-label="Gallery"
        className="flex h-[65vh] flex-col rounded-t-3xl border-t border-border/80 bg-popover/95 shadow-2xl shadow-black/60 backdrop-blur-md"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-1 w-10 rounded-full bg-border"
              aria-hidden
            />
            <h2 className="text-sm font-medium text-foreground">Gallery</h2>
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
                  aria-label="Pinned only"
                  data-testid="gallery-pinned-toggle"
                  data-active={pinnedOnly}
                  onClick={() => setPinnedOnly((v) => !v)}
                  className={`h-7 w-7 rounded-full ${
                    pinnedOnly ? "bg-amber-500/20 text-amber-200" : ""
                  }`}
                >
                  <Star
                    className={`h-3.5 w-3.5 ${pinnedOnly ? "fill-current" : ""}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {pinnedOnly ? "Showing pinned only" : "Show pinned only"}
              </TooltipContent>
            </Tooltip>
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
        </header>

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
          <EmptyState pinnedOnly={pinnedOnly} hasSearch={search.length > 0} />
        ) : (
          <div className="grid flex-1 auto-rows-[180px] grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 overflow-y-auto p-4">
            {data.map((row) => (
              <GenerationCard
                key={row.id}
                row={row}
                onChanged={() => void refresh()}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({
  pinnedOnly,
  hasSearch,
}: {
  pinnedOnly: boolean;
  hasSearch: boolean;
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <p className="text-sm font-medium text-foreground">
          {pinnedOnly
            ? "No pinned items"
            : hasSearch
              ? "No matches"
              : "No results yet"}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {pinnedOnly
            ? "Pin a generation to keep it here."
            : hasSearch
              ? "Try a different search term."
              : "Once you run a recipe, every image and text result lands here automatically."}
        </p>
      </div>
    </div>
  );
}

function GenerationCard({
  row,
  onChanged,
}: {
  row: GenerationRecord;
  onChanged: () => void;
}) {
  const single = Array.isArray(row.output) ? row.output[0] : row.output;
  return (
    <div
      data-testid="gallery-card"
      data-pinned={row.pinned}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card/60 transition-colors hover:border-border"
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
        <p className="truncate text-[10.5px] text-foreground/80">
          {row.nodeKind}
        </p>
        {row.promptText ? (
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground/80">
            {row.promptText}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CardThumb({
  output,
}: {
  output: StandardizedOutput | undefined;
}) {
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
