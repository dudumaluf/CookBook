"use client";

import { useEffect } from "react";

import { CanvasArea } from "./canvas-area";
import { LibraryPanel } from "./library-panel";
import { QueuePanel } from "./queue-panel";
import { PromptBar } from "./prompt-bar";
import { CanvasControls } from "./canvas-controls";
import { AddNodeButton } from "./add-node-button";
import { CommandPalette } from "./command-palette";
import { LogsPanel } from "./logs-panel";
import { GalleryDrawer } from "./gallery-drawer";
import { ProjectMenu } from "./project-menu";
import { EditableTitle } from "./editable-title";
import { useLayoutShortcuts } from "@/lib/hooks/use-layout-shortcuts";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";

/**
 * AppShell — refactor v3 (ADR-0013)
 *
 * The top bar is gone. The canvas is full-bleed and every UI primitive
 * floats over it as an independent overlay:
 *
 *   top-left      ProjectMenu  (logo + chevron, opens DropdownMenu)
 *   top-center    EditableTitle pill
 *   side-left     LibraryPanel (vertically centered, ⌘1)
 *   side-right    QueuePanel   (vertically centered, ⌘2)
 *   bottom-left   AddNodeButton (also via right-click + ⌘.)
 *   bottom-center PromptBar + ChatSheet (⌘J)
 *   bottom-right  CanvasControls (gallery ⌘G, theme)
 *   overlays      LogsPanel (⌘⇧L), CommandPalette (⌘K), GalleryDrawer
 *
 * Same visual language everywhere: rounded-full pills + rounded-2xl cards,
 * border-border/70, bg-popover/95, backdrop-blur, soft shadow.
 */
export function AppShell() {
  useLayoutShortcuts();
  const libraryOpen = useLayoutStore((s) => s.libraryOpen);

  // Rehydrate persisted stores after mount so SSR HTML == client first render.
  useEffect(() => {
    useLayoutStore.persist.rehydrate();
    useProjectStore.persist.rehydrate();
  }, []);

  const addNodeLeft = libraryOpen ? "calc(280px + 1.5rem)" : "0.75rem";

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <CanvasArea />

      {/* Top-left: logo + chevron menu */}
      <div className="pointer-events-auto absolute left-3 top-3 z-30">
        <ProjectMenu />
      </div>

      {/* Top-center: editable project title */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center">
        <div className="pointer-events-auto">
          <EditableTitle />
        </div>
      </div>

      {/* Side floating panels (vertically centered) */}
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

      {/* Edge / modal overlays */}
      <LogsPanel />
      <GalleryDrawer />
      <CommandPalette />
    </div>
  );
}
