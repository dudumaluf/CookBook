"use client";

import { LayoutGrid, List, Maximize2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { LibraryThumb, LibraryView } from "@/lib/stores/layout-store";
import { cn } from "@/lib/utils";

/**
 * LibraryToolbar (Library revamp) — the shared search + filter + view
 * controls used by BOTH the Library panel and the Library drawer. Dumb /
 * controlled: the parent owns the state and builds the filter chips
 * (so it can mix asset kinds with the separate Recipes source).
 */

export interface LibraryChip {
  id: string;
  label: string;
  count: number;
}

interface LibraryToolbarProps {
  query: string;
  onQueryChange: (q: string) => void;
  chips: LibraryChip[];
  activeChip: string;
  onChipChange: (id: string) => void;
  view: LibraryView;
  onViewChange: (v: LibraryView) => void;
  thumb: LibraryThumb;
  onThumbChange: (t: LibraryThumb) => void;
  /** When provided, renders an "expand to drawer" button (panel only). */
  onExpand?: () => void;
}

const THUMB_SIZES: LibraryThumb[] = ["s", "m", "l"];

export function LibraryToolbar({
  query,
  onQueryChange,
  chips,
  activeChip,
  onChipChange,
  view,
  onViewChange,
  thumb,
  onThumbChange,
  onExpand,
}: LibraryToolbarProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* Search + view toggle + expand */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search assets…"
            aria-label="Search assets"
            className="h-7 rounded-md pl-7 pr-6 text-xs"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5">
          <ViewToggle
            active={view === "grid"}
            onClick={() => onViewChange("grid")}
            label="Grid view"
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
          />
          <ViewToggle
            active={view === "list"}
            onClick={() => onViewChange("list")}
            label="List view"
            icon={<List className="h-3.5 w-3.5" />}
          />
        </div>

        {onExpand ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onExpand}
                aria-label="Expand library"
                className="h-7 w-7 text-muted-foreground"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Expand library</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {/* Type filter chips */}
      {chips.length > 1 ? (
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => onChipChange(chip.id)}
              data-active={activeChip === chip.id ? "true" : "false"}
              data-testid={`library-chip-${chip.id}`}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                activeChip === chip.id
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border/50 text-muted-foreground hover:text-foreground",
              )}
            >
              {chip.label}
              <span className="tabular-nums opacity-60">{chip.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Thumbnail size — grid view only */}
      {view === "grid" ? (
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
            Size
          </span>
          {THUMB_SIZES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onThumbChange(t)}
              data-active={thumb === t ? "true" : "false"}
              aria-label={`Thumbnail size ${t.toUpperCase()}`}
              className={cn(
                "h-5 w-5 rounded text-[10px] font-semibold uppercase transition-colors",
                thumb === t
                  ? "bg-accent/15 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.06]",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded transition-colors",
            active
              ? "bg-accent/15 text-foreground"
              : "text-muted-foreground hover:bg-foreground/[0.06]",
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
