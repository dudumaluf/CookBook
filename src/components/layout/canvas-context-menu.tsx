"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Plus,
  Library as LibraryIcon,
  Activity,
  Images,
  Package,
} from "lucide-react";

import { SaveRecipeDialog } from "@/components/library/save-recipe-dialog";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * CanvasContextMenu
 *
 * Right-click handler for the canvas area. Renders a small floating menu at
 * the click position with the most common canvas-level actions. Day 1: the
 * "Add node…" entry hands off to the AddNodeButton's popover. M0a replaces
 * that hand-off with a positional node selector anchored at the click coords.
 *
 * The component renders its children in a wrapper that listens to onContextMenu
 * and onClick (to close on outside click).
 */
export function CanvasContextMenu({ children }: { children: ReactNode }) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const { setAddNodePopoverOpen, toggleLibrary, toggleQueue, toggleGallery } =
    useLayoutStore();
  // Reads selectedNodeIds reactively so the "Save selection as recipe…"
  // entry only renders when the user actually has nodes selected.
  const selectedNodeIds = useWorkflowStore((s) => s.selectedNodeIds);

  const close = useCallback(() => setCoords(null), []);

  useEffect(() => {
    if (!coords) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [coords, close]);

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        setCoords({ x: e.clientX, y: e.clientY });
      }}
      onClick={() => coords && close()}
      className="contents"
    >
      {children}
      {coords && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={close}
            className="fixed inset-0 z-[60] cursor-default"
          />
          <div
            role="menu"
            aria-label="Canvas actions"
            className="fixed z-[61] flex w-48 flex-col rounded-lg border border-border/80 bg-popover/95 p-1 text-sm text-popover-foreground shadow-xl shadow-black/40 backdrop-blur-md"
            style={{ left: coords.x, top: coords.y }}
          >
            <MenuItem
              icon={<Plus className="h-3.5 w-3.5" />}
              label="Add node…"
              shortcut="⌘."
              onClick={() => {
                setAddNodePopoverOpen(true);
                close();
              }}
            />
            {selectedNodeIds.length > 0 ? (
              <MenuItem
                icon={<Package className="h-3.5 w-3.5" />}
                label={`Save ${selectedNodeIds.length} ${selectedNodeIds.length === 1 ? "node" : "nodes"} as recipe…`}
                onClick={() => {
                  // Snapshot the selection at click-time. The dialog
                  // re-derives I/O from these ids so the user can keep
                  // panning / zooming without affecting the save.
                  setSavingIds(selectedNodeIds);
                  setSaveOpen(true);
                  close();
                }}
              />
            ) : null}
            <Separator />
            <MenuItem
              icon={<LibraryIcon className="h-3.5 w-3.5" />}
              label="Toggle library"
              shortcut="⌘1"
              onClick={() => {
                toggleLibrary();
                close();
              }}
            />
            <MenuItem
              icon={<Activity className="h-3.5 w-3.5" />}
              label="Toggle queue"
              shortcut="⌘2"
              onClick={() => {
                toggleQueue();
                close();
              }}
            />
            <MenuItem
              icon={<Images className="h-3.5 w-3.5" />}
              label="Open gallery"
              shortcut="⌘G"
              onClick={() => {
                toggleGallery();
                close();
              }}
            />
          </div>
        </>
      )}
      <SaveRecipeDialog
        open={saveOpen}
        onOpenChange={(open) => {
          setSaveOpen(open);
          if (!open) setSavingIds([]);
        }}
        selectedNodeIds={savingIds}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-muted/50 focus:bg-muted/50 focus:outline-none"
    >
      <span className="flex h-4 w-4 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="flex-1 text-xs">{label}</span>
      {shortcut && (
        <span className="text-[10px] text-muted-foreground">{shortcut}</span>
      )}
    </button>
  );
}

function Separator() {
  return <div className="my-0.5 h-px bg-border/60" />;
}
