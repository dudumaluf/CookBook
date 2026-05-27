"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { CanvasArea } from "./canvas-area";
import { LibraryPanel } from "./library-panel";
import { QueuePanel } from "./queue-panel";
import { PromptBar } from "./prompt-bar";
import { AddNodeButton } from "./add-node-button";
import { GalleryButton } from "./gallery-button";
import { RunButton } from "./run-button";
import { CommandPalette } from "./command-palette";
import { LogsPanel } from "./logs-panel";
import { GalleryDrawer } from "./gallery-drawer";
import { ProjectMenu } from "./project-menu";
import { EditableTitle } from "./editable-title";
import { useSession } from "@/lib/auth/use-session";
import { useLayoutShortcuts } from "@/lib/hooks/use-layout-shortcuts";
import { useAssetStore } from "@/lib/stores/asset-store";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useProjectStore } from "@/lib/stores/project-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import {
  bootstrapForUser,
  startAutoSave,
} from "@/lib/sync/project-sync";

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
  const { user } = useSession();
  const [syncStatus, setSyncStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");

  // Rehydrate persisted stores after mount so SSR HTML == client first render.
  // ORDER MATTERS: asset-store rehydrates BEFORE workflow-store because the
  // workflow-store v8→v9 migration calls `useAssetStore.getState().createGroup`
  // to materialise an Untitled group for every legacy iterator with `assetIds[]`
  // in its config (ADR-0032, Slice 5.6). If workflow rehydrated first, its
  // migrate would seed groups onto an empty asset-store that would then
  // get OVERWRITTEN by the asset-store's own rehydrate seconds later.
  useEffect(() => {
    useLayoutStore.persist.rehydrate();
    useProjectStore.persist.rehydrate();
    useAssetStore.persist.rehydrate();
    useWorkflowStore.persist.rehydrate();
  }, []);

  // Slice 6.1 — once authenticated, bootstrap from cloud and start
  // auto-save. The shell is wrapped in `<AuthGate>` so this effect only
  // fires when `user` is non-null. When user signs out (`user` becomes
  // null), cleanup runs and we leave `syncStatus` untouched (no setState
  // outside of authenticated path → satisfies react-hooks rules).
  useEffect(() => {
    if (!user) return;
    let unsubscribeAutoSave: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      setSyncStatus("loading");
      try {
        const result = await bootstrapForUser(user.id);
        if (cancelled) return;
        useProjectStore.getState().setId(result.project.id);
        useProjectStore.getState().setName(result.project.name);
        if (result.migrated) {
          toast.success("Local project migrated to cloud");
        }
        unsubscribeAutoSave = startAutoSave({
          projectId: result.project.id,
          ownerId: user.id,
          onError: (err) => {
            console.error("[project-sync] save failed:", err);
            toast.error("Failed to save project changes — will retry");
          },
        });
        setSyncStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[project-sync] bootstrap failed:", err);
        toast.error("Failed to load project from cloud");
        setSyncStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      unsubscribeAutoSave?.();
    };
  }, [user]);

  // While the cloud project is loading, show a tiny centered spinner so we
  // don't paint stale localStorage state for a flash before swapping it for
  // cloud state. Once `ready`, the canvas hydrates with the right data.
  if (syncStatus === "loading") {
    return (
      <div
        data-testid="shell-loading"
        className="flex h-screen w-screen items-center justify-center bg-background"
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

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

      {/* Top-right cluster: Gallery (look at past work) → Run (kick off the
       *  current graph) → Add Node (extend the graph). Reads left-to-right
       *  as a workflow sentence. Queue panel below is vertically centered
       *  → no collision; the add-node popover (z-50) overlays the queue
       *  when both are open. */}
      <div className="pointer-events-none absolute right-3 top-3 z-30 flex items-center gap-1.5">
        <GalleryButton />
        <RunButton />
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
