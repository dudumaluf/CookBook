"use client";

import { useEffect } from "react";

import { TopBar } from "./top-bar";
import { CanvasArea } from "./canvas-area";
import { LibraryPanel } from "./library-panel";
import { QueuePanel } from "./queue-panel";
import { PromptBar } from "./prompt-bar";
import { CanvasControls } from "./canvas-controls";
import { AddNodeButton } from "./add-node-button";
import { CommandPalette } from "./command-palette";
import { LogsPanel } from "./logs-panel";
import { GalleryDrawer } from "./gallery-drawer";
import { useLayoutShortcuts } from "@/lib/hooks/use-layout-shortcuts";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";

/**
 * AppShell — Refactor v2 (ADR-0012)
 *
 * Canvas is the hero, edge-to-edge. Every panel floats over it with breathing
 * room around the edges (12px), rounded corners, soft shadow, backdrop-blur.
 * No fixed properties panel — properties become a node-anchored popover in
 * M0a once nodes exist.
 *
 * Layout (z-axis stack inside the canvas wrapper):
 *   bg canvas + welcome
 *   ↳ context menu (right-click)
 *   ↳ floating panels (Library left, Queue right) — z-20
 *   ↳ floating action clusters (AddNode bottom-left, CanvasControls bottom-right) — z-20
 *   ↳ PromptBar centered — z-30
 *   ↳ LogsPanel right-edge overlay — z-40
 *   ↳ GalleryDrawer bottom drawer (full-overlay) — z-50
 *   ↳ CommandPalette modal — z-50+ via Dialog Portal
 *   ↳ TopBar — z-30 (sits on top of the canvas)
 */
export function AppShell() {
  useLayoutShortcuts();
  const libraryOpen = useLayoutStore((s) => s.libraryOpen);

  // Rehydrate persisted stores after mount. Keeping SSR output = defaults
  // means there's no server/client mismatch, and the only price is a
  // sub-frame "snap" to persisted values right after hydration.
  useEffect(() => {
    useLayoutStore.persist.rehydrate();
    useProjectStore.persist.rehydrate();
  }, []);

  // AddNodeButton shifts right when the library panel is occupying the
  // bottom-left so the two never overlap.
  const addNodeLeft = libraryOpen ? "calc(280px + 1.5rem)" : "0.75rem";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <div className="relative flex flex-1 overflow-hidden">
        <CanvasArea />

        {/* Floating chrome — everything overlays the canvas */}
        <LibraryPanel />
        <QueuePanel />

        {/* Bottom-left: add node pill, slides right to clear the library */}
        <div
          className="pointer-events-none absolute bottom-3 z-20 transition-[left] duration-200"
          style={{ left: addNodeLeft }}
        >
          <AddNodeButton />
        </div>

        {/* Bottom-right: canvas controls cluster (gallery, theme) */}
        <CanvasControls />

        {/* Bottom-center: prompt bar + chat sheet */}
        <PromptBar />

        {/* Side overlays */}
        <LogsPanel />
      </div>

      {/* Full overlays (above everything inside main) */}
      <GalleryDrawer />
      <CommandPalette />
    </div>
  );
}
