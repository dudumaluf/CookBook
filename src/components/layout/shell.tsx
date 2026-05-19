"use client";

import { useEffect } from "react";

import { CanvasArea } from "./canvas-area";
import { LibraryPanel } from "./library-panel";
import { QueuePanel } from "./queue-panel";
import { PromptBar } from "./prompt-bar";
import { AddNodeButton } from "./add-node-button";
import { GalleryButton } from "./gallery-button";
import { CommandPalette } from "./command-palette";
import { LogsPanel } from "./logs-panel";
import { GalleryDrawer } from "./gallery-drawer";
import { ProjectMenu } from "./project-menu";
import { EditableTitle } from "./editable-title";
import { useLayoutShortcuts } from "@/lib/hooks/use-layout-shortcuts";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";

/**
 * AppShell — refactor v3 (ADR-0013) + v4 (ADR-0015 polish)
 *
 * The top bar is gone. The canvas is full-bleed and every UI primitive
 * floats over it as an independent overlay:
 *
 *   top-left      ProjectMenu  (logo + chevron, opens DropdownMenu)
 *   top-center    EditableTitle pill
 *   top-right     GalleryButton + AddNodeButton (paired pills, also ⌘. /
 *                 right-click for add-node)
 *   side-left     LibraryPanel (vertically centered, ⌘1)
 *   side-right    QueuePanel   (vertically centered, ⌘2)
 *   bottom-left   React Flow Controls (zoom / fit / theme, owned by CanvasFlow)
 *   bottom-center PromptBar + ChatSheet (⌘J)
 *   bottom-right  React Flow MiniMap (md+ viewports, owned by CanvasFlow)
 *   overlays      LogsPanel (⌘⇧L), CommandPalette (⌘K), GalleryDrawer
 *
 * Same visual language everywhere: rounded-full pills + rounded-2xl cards,
 * border-border/70, bg-popover/95, backdrop-blur, soft shadow.
 */
export function AppShell() {
  useLayoutShortcuts();

  // Rehydrate persisted stores after mount so SSR HTML == client first render.
  useEffect(() => {
    useLayoutStore.persist.rehydrate();
    useProjectStore.persist.rehydrate();
    useWorkflowStore.persist.rehydrate();
    useAssetStore.persist.rehydrate();
  }, []);

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

      {/* Top-right: gallery + add node (paired pills). Mirrors top-left so
       *  the four corners feel deliberate. Queue panel below is vertically
       *  centered → no collision; the add-node popover (z-50) overlays the
       *  queue when both are open. */}
      <div className="pointer-events-none absolute right-3 top-3 z-30 flex items-center gap-1.5">
        <GalleryButton />
        <AddNodeButton />
      </div>

      {/* Side floating panels (vertically centered) */}
      <LibraryPanel />
      <QueuePanel />

      {/* Bottom-center: prompt bar + chat sheet */}
      <PromptBar />

      {/* Edge / modal overlays */}
      <LogsPanel />
      <GalleryDrawer />
      <CommandPalette />
    </div>
  );
}
